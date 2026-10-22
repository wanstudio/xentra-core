/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  important: ':is(#xentra-owner-app-root, #modern-menu-editor-root, #modern-menu-portal-root, #modern-business-hub-root, #modern-catalog-subhub-root, #modern-categories-page-root, #modern-item-master-page-root, #modern-category-editor-page-root, #modern-category-sort-page-root)',
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F0FDF4',
          500: '#22C55E',
          600: '#16A34A',
          700: '#15803D',
        },
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '20px',
      },
    },
  },
  plugins: [],
};
