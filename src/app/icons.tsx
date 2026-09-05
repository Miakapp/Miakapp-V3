import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function IconFrame({ children, ...props }: IconProps): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <path d="m3.5 10.7 8.5-7 8.5 7v9.1a.7.7 0 0 1-.7.7H4.2a.7.7 0 0 1-.7-.7v-9.1Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M9 20.5v-6.3h6v6.3" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
    </IconFrame>
  );
}

export function ActivityIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <path d="M4 12h3l2-6 4 12 2.2-6H20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </IconFrame>
  );
}

export function SettingsIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="3.1" stroke="currentColor" strokeWidth="1.7" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
    </IconFrame>
  );
}

export function SparkIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <path d="M12 2.8c.7 4.2 3 6.5 7.2 7.2-4.2.7-6.5 3-7.2 7.2-.7-4.2-3-6.5-7.2-7.2C9 9.3 11.3 7 12 2.8Z" fill="currentColor" />
      <path d="M19 16.2c.2 1.4 1 2.2 2.4 2.4-1.4.2-2.2 1-2.4 2.4-.2-1.4-1-2.2-2.4-2.4 1.4-.2 2.2-1 2.4-2.4Z" fill="currentColor" />
    </IconFrame>
  );
}

export function LockIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <rect height="10" rx="2" stroke="currentColor" strokeWidth="1.7" width="14" x="5" y="10" />
      <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </IconFrame>
  );
}
