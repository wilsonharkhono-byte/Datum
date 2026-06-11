import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 14, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function BellIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </Svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  );
}

export function PaperclipIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </Svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 12.5 10 17.5 19.5 7" />
    </Svg>
  );
}

export function XIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6 18 18" />
      <path d="M18 6 6 18" />
    </Svg>
  );
}

/** Diagonal-split Trello mark — two stacked rectangles inside a frame */
export function TrelloIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <rect x="7" y="7" width="3" height="9" rx="0.5" />
      <rect x="14" y="7" width="3" height="5" rx="0.5" />
    </Svg>
  );
}

/** Document / clipboard with two ruled lines — the "activity log" mark */
export function ClipboardIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="8" y="3" width="8" height="3" rx="0.5" />
      <path d="M16 4.5h2.5a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1H8" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </Svg>
  );
}

/** Open book — "morning brief" */
export function BookIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H10a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4.5A1.5 1.5 0 0 1 3 16.5z" />
      <path d="M21 5.5A1.5 1.5 0 0 0 19.5 4H14a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
    </Svg>
  );
}

/** Settings gear — Trello-style "open settings" mark */
export function GearIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />
      <path d="m19.4 14.7-1.4-.8a6 6 0 0 0 0-3.8l1.4-.8a1 1 0 0 0 .4-1.4l-1.6-2.8a1 1 0 0 0-1.3-.4l-1.4.8a6 6 0 0 0-3.3-1.9V2a1 1 0 0 0-1-1h-3.2a1 1 0 0 0-1 1v1.6a6 6 0 0 0-3.3 1.9l-1.4-.8a1 1 0 0 0-1.3.4L1.4 7.9a1 1 0 0 0 .4 1.4l1.4.8a6 6 0 0 0 0 3.8l-1.4.8a1 1 0 0 0-.4 1.4l1.6 2.8a1 1 0 0 0 1.3.4l1.4-.8a6 6 0 0 0 3.3 1.9V22a1 1 0 0 0 1 1h3.2a1 1 0 0 0 1-1v-1.6a6 6 0 0 0 3.3-1.9l1.4.8a1 1 0 0 0 1.3-.4l1.6-2.8a1 1 0 0 0-.4-1.4z" />
    </Svg>
  );
}

/** Four-point sparkle — "AI assistant" mark */
export function SparkIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21" />
      <path d="m6.5 6.5 2.2 2.2M15.3 15.3l2.2 2.2M17.5 6.5l-2.2 2.2M8.7 15.3l-2.2 2.2" />
    </Svg>
  );
}
