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
      viewBox="0 0 236.4 35.3"
      fill="currentColor"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M116.5,35.3h-6.2V6h-11.1V.2h28.4v5.7h-11.1v29.3Z" />
      <path d="M178.5,20.1c0,10.5-5.9,15.7-15.1,15.7s-14.9-5.2-14.9-15.4V.2h6.2v19.9c0,6.5,3.4,10,8.9,10s8.8-3.3,8.8-9.8V.2h6.2v19.9Z" />
      <path d="M219.2,26.7h-.2l-11-16.4v25h-6.1V.2h6.6l10.7,16.6L229.8.2h6.6v35h-6.2V10.2l-11.1,16.5Z" />
      <path d="M13.1.2H0v5.6h13.1c7.4,0,12.2,5,12.2,12s-4.8,11.9-12.2,11.9h-6.9v-15.3L0,10.4v24.9h13.1c11,0,18.6-7.7,18.6-17.6S24.1.2,13.1.2Z" />
      <polygon points="69.8 0 64.1 0 48.7 35.3 55 35.3 58.6 26.8 60.9 21.4 66.9 7.4 72.9 21.4 75.2 26.8 78.7 35.3 85.2 35.3 69.8 0" />
    </svg>
  );
}
