type DatumWordmarkProps = {
  className?: string;
  title?: string;
};

/**
 * DATUM wordmark logo. Inlined so it inherits the surrounding text color via
 * `currentColor` — works on both the light header and the dark login panel.
 */
export function DatumWordmark({ className, title = "DATUM" }: DatumWordmarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 257.4 48.6"
      fill="currentColor"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M127,41.8h-6.2V12.5h-11.1v-5.7h28.4v5.7h-11.1v29.3Z" />
      <path d="M189,26.6c0,10.5-5.9,15.7-15.1,15.7s-14.9-5.2-14.9-15.4V6.8h6.2v19.9c0,6.5,3.4,10,8.9,10s8.8-3.3,8.8-9.8V6.8h6.2v19.9Z" />
      <path d="M229.7,33.2h-.2l-11-16.4v25h-6.1V6.8h6.6l10.7,16.6,10.7-16.6h6.6v35h-6.2v-25.1l-11.1,16.5Z" />
      <path d="M23.6,6.8h-13.1v5.6h13.1c7.4,0,12.2,5,12.2,12s-4.8,11.9-12.2,11.9h-6.9v-15.3l-6.2-4v24.9h13.1c11,0,18.6-7.7,18.6-17.6S34.6,6.8,23.6,6.8Z" />
      <polygon points="80.3 6.5 74.6 6.5 59.2 41.8 65.5 41.8 69.1 33.3 71.4 27.9 77.4 13.9 83.4 27.9 85.7 33.3 89.2 41.8 95.7 41.8 80.3 6.5" />
    </svg>
  );
}
