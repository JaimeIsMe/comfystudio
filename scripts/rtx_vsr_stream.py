#!/usr/bin/env python3
"""Stream a video through NVIDIA Video Super Resolution one frame at a time."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
import time
from fractions import Fraction
from pathlib import Path

import cupy as cp
import numpy as np

from nvvfx import VideoSuperRes
from nvvfx.effects import QualityLevel


QUALITY_LEVELS = {
    "LOW": QualityLevel.LOW,
    "MEDIUM": QualityLevel.MEDIUM,
    "HIGH": QualityLevel.HIGH,
    "ULTRA": QualityLevel.ULTRA,
}


def emit(event: str, **payload: object) -> None:
    print(json.dumps({"event": event, **payload}, separators=(",", ":")), flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--width", required=True, type=int)
    parser.add_argument("--height", required=True, type=int)
    parser.add_argument("--quality", default="HIGH", choices=tuple(QUALITY_LEVELS))
    parser.add_argument("--ffmpeg", required=True, type=Path)
    parser.add_argument("--ffprobe", required=True, type=Path)
    parser.add_argument("--encoder", default="h264_nvenc")
    parser.add_argument("--cq", default=18, type=int)
    parser.add_argument(
        "--max-frames",
        default=0,
        type=int,
        help="Limit processing for diagnostics; zero processes the entire video.",
    )
    return parser.parse_args()


def run_json(command: list[str]) -> dict:
    completed = subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return json.loads(completed.stdout)


def probe_video(ffprobe: Path, input_path: Path) -> dict:
    data = run_json([
        str(ffprobe),
        "-v", "error",
        "-show_entries", "stream=index,codec_type,codec_name,width,height,avg_frame_rate,nb_frames,duration",
        "-show_entries", "format=duration",
        "-of", "json",
        str(input_path),
    ])
    streams = data.get("streams") or []
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    if not video:
        raise RuntimeError("Input has no video stream.")

    width = int(video.get("width") or 0)
    height = int(video.get("height") or 0)
    if width <= 0 or height <= 0:
        raise RuntimeError("Could not determine the source dimensions.")

    frame_rate_text = str(video.get("avg_frame_rate") or "0/1")
    frame_rate = Fraction(frame_rate_text)
    if frame_rate <= 0:
        raise RuntimeError("Could not determine the source frame rate.")

    duration = float(video.get("duration") or (data.get("format") or {}).get("duration") or 0)
    frame_count = int(video.get("nb_frames") or 0)
    if frame_count <= 0 and duration > 0:
        frame_count = round(duration * float(frame_rate))

    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    return {
        "width": width,
        "height": height,
        "fps": frame_rate,
        "duration": duration,
        "frame_count": frame_count,
        "audio_codec": str((audio or {}).get("codec_name") or ""),
        "has_audio": audio is not None,
    }


def collect_stderr(pipe, sink: list[str]) -> None:
    try:
        for raw_line in iter(pipe.readline, b""):
            sink.append(raw_line.decode("utf-8", errors="replace").rstrip())
            if len(sink) > 80:
                del sink[:-80]
    finally:
        pipe.close()


def read_exact(stream, target: memoryview) -> int:
    offset = 0
    while offset < len(target):
        count = stream.readinto(target[offset:])
        if not count:
            break
        offset += count
    return offset


def terminate_process(process: subprocess.Popen | None) -> None:
    if not process or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def build_encoder_command(
    args: argparse.Namespace,
    info: dict,
    fps_text: str,
) -> list[str]:
    command = [
        str(args.ffmpeg),
        "-hide_banner",
        "-loglevel", "warning",
        "-nostdin",
        "-y",
        "-f", "rawvideo",
        "-pixel_format", "rgb24",
        "-video_size", f"{args.width}x{args.height}",
        "-framerate", fps_text,
        "-i", "pipe:0",
        "-i", str(args.input),
        "-map", "0:v:0",
    ]
    if info["has_audio"]:
        command.extend(["-map", "1:a:0?"])
    command.extend([
        "-map_metadata", "1",
        "-c:v", args.encoder,
        "-preset", "p6",
        "-tune", "hq",
        "-rc", "vbr",
        "-cq", str(args.cq),
        "-b:v", "0",
        "-pix_fmt", "yuv420p",
    ])
    if info["has_audio"]:
        if info["audio_codec"] == "aac":
            command.extend(["-c:a", "copy"])
        else:
            command.extend(["-c:a", "aac", "-b:a", "192k"])
    target_frames = info["frame_count"]
    if args.max_frames > 0:
        target_frames = min(target_frames, args.max_frames) if target_frames else args.max_frames
    target_duration = (
        target_frames / float(info["fps"])
        if target_frames
        else info["duration"]
    )
    if target_duration > 0:
        command.extend(["-t", f"{target_duration:.9f}"])
    command.extend(["-movflags", "+faststart", str(args.output)])
    return command


def main() -> int:
    args = parse_args()
    args.input = args.input.resolve()
    args.output = args.output.resolve()
    args.ffmpeg = args.ffmpeg.resolve()
    args.ffprobe = args.ffprobe.resolve()

    if not args.input.is_file():
        raise RuntimeError(f"Input does not exist: {args.input}")
    if not args.ffmpeg.is_file() or not args.ffprobe.is_file():
        raise RuntimeError("FFmpeg or FFprobe was not found.")
    if args.width < 8 or args.height < 8:
        raise RuntimeError("Output dimensions must be at least 8x8.")
    try:
        gpu_properties = cp.cuda.runtime.getDeviceProperties(0)
        gpu_name = gpu_properties.get("name", "NVIDIA GPU")
        if isinstance(gpu_name, bytes):
            gpu_name = gpu_name.decode("utf-8", errors="replace")
    except Exception as error:
        raise RuntimeError(f"CUDA is not available in this Python environment: {error}") from error

    args.output.parent.mkdir(parents=True, exist_ok=True)
    info = probe_video(args.ffprobe, args.input)
    fps: Fraction = info["fps"]
    fps_text = f"{fps.numerator}/{fps.denominator}"
    total_frames = info["frame_count"]
    if args.max_frames > 0:
        total_frames = min(total_frames, args.max_frames) if total_frames else args.max_frames
    frame_size = info["width"] * info["height"] * 3
    raw_frame = bytearray(frame_size)
    raw_view = memoryview(raw_frame)
    source_frame = np.frombuffer(raw_frame, dtype=np.uint8).reshape(
        info["height"], info["width"], 3
    )

    emit(
        "start",
        input=str(args.input),
        output=str(args.output),
        sourceWidth=info["width"],
        sourceHeight=info["height"],
        outputWidth=args.width,
        outputHeight=args.height,
        fps=fps_text,
        totalFrames=total_frames,
        durationSeconds=info["duration"],
        quality=args.quality,
        gpu=str(gpu_name),
    )

    decoder_stderr: list[str] = []
    encoder_stderr: list[str] = []
    decoder = None
    encoder = None
    started_at = time.perf_counter()
    processed = 0

    try:
        decoder_command = [
            str(args.ffmpeg),
            "-hide_banner",
            "-loglevel", "warning",
            "-nostdin",
            "-i", str(args.input),
            "-map", "0:v:0",
            "-an",
            "-sn",
            "-dn",
            "-fps_mode", "passthrough",
        ]
        if args.max_frames > 0:
            decoder_command.extend(["-frames:v", str(args.max_frames)])
        decoder_command.extend([
            "-f", "rawvideo",
            "-pix_fmt", "rgb24",
            "pipe:1",
        ])
        decoder = subprocess.Popen(
            decoder_command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=frame_size * 2,
        )
        encoder = subprocess.Popen(
            build_encoder_command(args, info, fps_text),
            stdin=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        if not decoder.stdout or not decoder.stderr or not encoder.stdin or not encoder.stderr:
            raise RuntimeError("Could not create FFmpeg pipes.")

        threading.Thread(target=collect_stderr, args=(decoder.stderr, decoder_stderr), daemon=True).start()
        threading.Thread(target=collect_stderr, args=(encoder.stderr, encoder_stderr), daemon=True).start()

        with VideoSuperRes(QUALITY_LEVELS[args.quality]) as super_res:
            super_res.output_width = args.width
            super_res.output_height = args.height
            super_res.load()

            while True:
                bytes_read = read_exact(decoder.stdout, raw_view)
                if bytes_read == 0:
                    break
                if bytes_read != frame_size:
                    raise RuntimeError(
                        f"Decoder returned a partial frame ({bytes_read}/{frame_size} bytes)."
                    )

                input_cuda = cp.ascontiguousarray(
                    cp.asarray(source_frame).transpose(2, 0, 1),
                    dtype=cp.float32,
                )
                input_cuda *= 1.0 / 255.0
                result = super_res.run(input_cuda)
                output_cuda = cp.from_dlpack(result.image)
                output_u8 = cp.rint(cp.clip(output_cuda, 0.0, 1.0) * 255.0).astype(cp.uint8)
                output_cpu = cp.asnumpy(output_u8.transpose(1, 2, 0))
                encoder.stdin.write(memoryview(output_cpu))
                processed += 1

                del input_cuda, output_cuda, output_u8, output_cpu, result
                elapsed = time.perf_counter() - started_at
                if processed == 1 or processed % 5 == 0:
                    rate = processed / elapsed if elapsed > 0 else 0.0
                    remaining = max(0, total_frames - processed)
                    emit(
                        "progress",
                        frame=processed,
                        totalFrames=total_frames,
                        percent=(processed / total_frames * 100.0) if total_frames else None,
                        fps=rate,
                        etaSeconds=(remaining / rate) if rate > 0 and total_frames else None,
                    )

        decoder.stdout.close()
        encoder.stdin.close()
        decoder_code = decoder.wait(timeout=30)
        encoder_code = encoder.wait(timeout=120)
        if decoder_code != 0:
            raise RuntimeError("FFmpeg decode failed: " + "\n".join(decoder_stderr[-12:]))
        if encoder_code != 0:
            raise RuntimeError("FFmpeg encode failed: " + "\n".join(encoder_stderr[-12:]))
        if processed <= 0:
            raise RuntimeError("No video frames were processed.")
        if not args.output.is_file() or args.output.stat().st_size <= 0:
            raise RuntimeError("The output video was not created.")

        elapsed = time.perf_counter() - started_at
        emit(
            "complete",
            frames=processed,
            elapsedSeconds=elapsed,
            averageFps=processed / elapsed if elapsed > 0 else 0.0,
            cupyPoolBytes=cp.get_default_memory_pool().total_bytes(),
            outputBytes=args.output.stat().st_size,
        )
        return 0
    except KeyboardInterrupt:
        emit("cancelled", frame=processed)
        return 130
    except Exception as error:
        emit(
            "error",
            message=str(error),
            frame=processed,
            decoderLog=decoder_stderr[-12:],
            encoderLog=encoder_stderr[-12:],
        )
        return 1
    finally:
        if decoder and decoder.stdout and not decoder.stdout.closed:
            decoder.stdout.close()
        if encoder and encoder.stdin and not encoder.stdin.closed:
            try:
                encoder.stdin.close()
            except BrokenPipeError:
                pass
        terminate_process(decoder)
        terminate_process(encoder)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        emit("error", message=str(error), frame=0)
        raise SystemExit(1)
