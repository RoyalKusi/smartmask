import { webDarkTheme, webLightTheme, type Theme } from '@fluentui/react-components';

export type ThemeName = 'light' | 'dark';

/** SmartMask semantic token layer. The only place colour literals live. */
export interface Palette {
  bgApp: string;
  bgSurface: string;
  bgSubtle: string;
  fgPrimary: string;
  fgSecondary: string;
  fgTertiary: string;
  strokeDefault: string;
  strokeSubtle: string;
  brand: string;
  brandHover: string;
  brandPressed: string;
  tagPiiHigh: string;
  tagFinancial: string;
  tagPiiMedium: string;
  success: string;
  warning: string;
  danger: string;
  onBrand: string;
  chartAdmin: string;
  chartSupport: string;
  chartAnalyst: string;
  chartNeutral: string;
}

export const PALETTES: Record<ThemeName, Palette> = {
  light: {
    bgApp: '#F3F3F3',
    bgSurface: '#FFFFFF',
    bgSubtle: '#FAFAFA',
    fgPrimary: '#242424',
    fgSecondary: '#424242',
    fgTertiary: '#616161',
    strokeDefault: '#D1D1D1',
    strokeSubtle: '#E0E0E0',
    brand: '#0F6CBD',
    brandHover: '#115EA3',
    brandPressed: '#0F548C',
    tagPiiHigh: '#C50F1F',
    tagFinancial: '#5C2E91',
    tagPiiMedium: '#BC4B09',
    success: '#107C10',
    warning: '#BC4B09',
    danger: '#B10E1C',
    onBrand: '#FFFFFF',
    chartAdmin: '#5C2E91',
    chartSupport: '#0F6CBD',
    chartAnalyst: '#0B7A6B',
    chartNeutral: '#8A8886',
  },
  dark: {
    bgApp: '#202020',
    bgSurface: '#292929',
    bgSubtle: '#1F1F1F',
    fgPrimary: '#FFFFFF',
    fgSecondary: '#D6D6D6',
    fgTertiary: '#ADADAD',
    strokeDefault: '#666666',
    strokeSubtle: '#525252',
    brand: '#479EF5',
    brandHover: '#62ABF5',
    brandPressed: '#2886DE',
    tagPiiHigh: '#DC626D',
    tagFinancial: '#B59DD9',
    tagPiiMedium: '#F4A261',
    success: '#54B054',
    warning: '#F7630C',
    danger: '#DC626D',
    onBrand: '#0A0A0A',
    chartAdmin: '#B59DD9',
    chartSupport: '#479EF5',
    chartAnalyst: '#4FD1B8',
    chartNeutral: '#A19F9D',
  },
};

const cssName = (k: string): string => `--sm-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

export function applyPalette(theme: ThemeName): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  for (const [k, v] of Object.entries(PALETTES[theme])) root.style.setProperty(cssName(k), v);
}

export const FONT_BASE = '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif';
export const FONT_MONO = '"Cascadia Code", Consolas, monospace';

export function fluentTheme(theme: ThemeName): Theme {
  const base = theme === 'dark' ? webDarkTheme : webLightTheme;
  const p = PALETTES[theme];
  return {
    ...base,
    fontFamilyBase: FONT_BASE,
    fontFamilyMonospace: FONT_MONO,
    colorBrandBackground: p.brand,
    colorBrandBackgroundHover: p.brandHover,
    colorBrandBackgroundPressed: p.brandPressed,
    colorBrandForegroundLink: p.brand,
    colorCompoundBrandStroke: p.brand,
    colorNeutralForeground1: p.fgPrimary,
    colorNeutralForeground2: p.fgSecondary,
    colorNeutralForeground3: p.fgTertiary,
    colorNeutralForegroundOnBrand: p.onBrand,
    colorNeutralBackground1: p.bgSurface,
    colorNeutralStroke1: p.strokeDefault,
    colorNeutralStroke2: p.strokeSubtle,
    colorStrokeFocus2: p.brand,
  };
}

export function readCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
