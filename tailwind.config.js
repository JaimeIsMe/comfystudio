/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'sf-dark': {
          950: 'rgb(var(--sf-dark-950) / <alpha-value>)',
          900: 'rgb(var(--sf-dark-900) / <alpha-value>)',
          800: 'rgb(var(--sf-dark-800) / <alpha-value>)',
          700: 'rgb(var(--sf-dark-700) / <alpha-value>)',
          600: 'rgb(var(--sf-dark-600) / <alpha-value>)',
          500: 'rgb(var(--sf-dark-500) / <alpha-value>)',
          400: 'rgb(var(--sf-dark-400) / <alpha-value>)',
        },
        'sf-accent': {
          DEFAULT: 'rgb(var(--sf-accent) / <alpha-value>)',
          hover: 'rgb(var(--sf-accent-hover) / <alpha-value>)',
          muted: 'rgb(var(--sf-accent-muted) / <alpha-value>)',
        },
        'sf-blue': {
          DEFAULT: 'rgb(var(--sf-blue) / <alpha-value>)',
          hover: 'rgb(var(--sf-blue-hover) / <alpha-value>)',
          muted: 'rgb(var(--sf-blue-muted) / <alpha-value>)',
        },
        'sf-clip': {
          video: 'rgb(var(--sf-clip-video) / <alpha-value>)',
          audio: 'rgb(var(--sf-clip-audio) / <alpha-value>)',
          text: 'rgb(var(--sf-clip-text) / <alpha-value>)',
        },
        'sf-success': 'rgb(var(--sf-success) / <alpha-value>)',
        'sf-warning': 'rgb(var(--sf-warning) / <alpha-value>)',
        'sf-error': 'rgb(var(--sf-error) / <alpha-value>)',
        'sf-text': {
          primary: 'rgb(var(--sf-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--sf-text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--sf-text-muted) / <alpha-value>)',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
