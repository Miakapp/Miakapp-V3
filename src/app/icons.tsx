import type { SVGProps } from 'react';

import type { AppBarIcon } from '../../component-runtime/src/app-contract';

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

export function StarIcon({ filled = false, ...props }: IconProps & { readonly filled?: boolean }): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <path
        d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.6Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </IconFrame>
  );
}

export function ChevronDownIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <path d="m7 10 5 5 5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </IconFrame>
  );
}

export function CloseIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconFrame>
  );
}

const BAR_ICON_PATHS: Readonly<Record<AppBarIcon, readonly string[]>> = {
  grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  bolt: ['M13 2.5 4.5 13.5H11l-1 8 8.5-11H12l1-8Z'],
  light: ['M9 18h6', 'M10 21h4', 'M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3Z'],
  thermometer: ['M10 4a2 2 0 1 1 4 0v10.3a4 4 0 1 1-4 0V4Z', 'M12 9v7'],
  camera: ['M4 8h3.5L9 5.5h6L16.5 8H20v11H4V8Z', 'M12 16.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 1 1 7 0v3'],
  list: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4.5 6h.01', 'M4.5 12h.01', 'M4.5 18h.01'],
  chart: ['M4 20h16', 'M7 16v-5', 'M12 16V6', 'M17 16v-8'],
  leaf: ['M5 19c0-8 5-13 14-14 0 9-5 14-13 14', 'M5 19 13 11'],
  star: ['m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z'],
};

/** The closed set of icons a home may give its bar buttons. */
export function BarIcon({ name, ...props }: IconProps & { readonly name: AppBarIcon }): React.JSX.Element {
  return (
    <IconFrame {...props}>
      {BAR_ICON_PATHS[name].map((d) => (
        <path d={d} key={d} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
      ))}
    </IconFrame>
  );
}
