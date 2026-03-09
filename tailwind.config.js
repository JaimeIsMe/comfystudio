/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // DaVinci Resolve inspired dark theme
        'sf-dark': {
          950: '#0d0d0d',      // Deepest background (timeline bg)
          900: '#1a1a1a',      // Main panel backgrounds
          800: '#242424',      // Slightly lighter panels
          700: '#2d2d2d',      // Borders, dividers
          600: '#383838',      // Hover states, lighter elements
          500: '#4a4a4a',      // Muted interactive elements
          400: '#5c5c5c',      // Disabled/inactive text
        },
        'sf-accent': {
          DEFAULT: '#565C6B',  // Muted blue (primary accent)
          hover: '#6a7080',    // Lighter on hover
          muted: '#4a5060',    // Darker variant
        },
        'sf-blue': {
          DEFAULT: '#5a7a9e',  // Desaturated blue for buttons (30% less saturation)
          hover: '#4a6a8e',    // Darker desaturated on hover
          muted: '#3a5a7e',    // Even more muted
        },
        'sf-clip': {
          video: '#3d7080',    // Desaturated teal for video clips (30% less saturation)
          audio: '#2d5f4a',    // Desaturated green for audio
          text: '#565C6B',     // Muted blue for text clips
        },
        'sf-success': '#22c55e',
        'sf-warning': '#565C6B',
        'sf-error': '#ef4444',
        'sf-text': {
          primary: '#e5e5e5',  // Slightly warmer white
          secondary: '#a3a3a3', // Muted gray
          muted: '#737373',    // Even more muted
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
