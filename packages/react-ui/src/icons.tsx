// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import type { IconMap } from './types.js';

/**
 * Shared SVG attributes for the bundled defaults. Each icon is a 16x16
 * `currentColor`-stroked outline so it inherits text colour from its slot.
 */
const baseSvgProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

function BrainIcon() {
  return (
    <svg {...baseSvgProps}>
      <path d="M9 3a3 3 0 0 0-3 3v.5a3 3 0 0 0-2 5.2A3 3 0 0 0 6 17v.5a3 3 0 0 0 6 0V3a3 3 0 0 0-3 0Z" />
      <path d="M15 3a3 3 0 0 1 3 3v.5a3 3 0 0 1 2 5.2A3 3 0 0 1 18 17v.5a3 3 0 0 1-6 0V3a3 3 0 0 1 3 0Z" />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg {...baseSvgProps}>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4 2.6-2.6Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...baseSvgProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg {...baseSvgProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6" />
      <path d="m15 9-6 6" />
    </svg>
  );
}

function CancelledIcon() {
  return (
    <svg {...baseSvgProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.5 5.5 18.5 18.5" />
    </svg>
  );
}

function LoaderIcon() {
  return (
    <svg {...baseSvgProps} className="mast-spin">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg {...baseSvgProps} fill="currentColor" stroke="none">
      <path d="M3 3 21 12 3 21l3-9-3-9Z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg {...baseSvgProps} fill="currentColor" stroke="none">
      <rect x="5" y="5" width="14" height="14" rx="1" />
    </svg>
  );
}

/**
 * Bundled defaults for every icon slot. Every key is populated, so callers
 * receive a `Required<IconMap>` from {@link useIcons}.
 */
export const defaultIcons: Required<IconMap> = {
  brain: <BrainIcon />,
  wrench: <WrenchIcon />,
  check: <CheckIcon />,
  error: <ErrorIcon />,
  cancelled: <CancelledIcon />,
  loader: <LoaderIcon />,
  send: <SendIcon />,
  stop: <StopIcon />,
};

/**
 * Internal context that distributes the icon set to every component below
 * `<AgentProvider>`. Kept separate from `AgentContext` so re-renders driven
 * by streaming state do not invalidate consumers that only read icons.
 */
const IconContext = createContext<Required<IconMap>>(defaultIcons);

/**
 * Internal provider used by `<AgentProvider>` to merge consumer overrides on
 * top of the bundled defaults before publishing the resulting map.
 */
export function IconProvider({ icons, children }: { icons?: IconMap; children: ReactNode }) {
  const value = useMemo<Required<IconMap>>(() => {
    if (!icons) return defaultIcons;
    return {
      brain: icons.brain ?? defaultIcons.brain,
      wrench: icons.wrench ?? defaultIcons.wrench,
      check: icons.check ?? defaultIcons.check,
      error: icons.error ?? defaultIcons.error,
      cancelled: icons.cancelled ?? defaultIcons.cancelled,
      loader: icons.loader ?? defaultIcons.loader,
      send: icons.send ?? defaultIcons.send,
      stop: icons.stop ?? defaultIcons.stop,
    };
  }, [icons]);

  return <IconContext.Provider value={value}>{children}</IconContext.Provider>;
}

/**
 * Internal hook used by components that render an icon slot. Always returns
 * a fully populated map, falling back to the bundled defaults for any slot
 * the consumer did not override.
 */
export function useIcons(): Required<IconMap> {
  return useContext(IconContext);
}
