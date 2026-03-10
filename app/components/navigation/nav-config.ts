import {
  Home,
  Film,
  Tv,
  Star,
  Radio,
  Bookmark,
  LayoutGrid,
  Search,
  Settings,
  Info,
  Code,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: ComponentType<{ className?: string }>;
  section: 'primary' | 'secondary';
  showInBottomTab: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', path: '/', icon: Home, section: 'primary', showInBottomTab: true },
  { id: 'movies', label: 'Movies', path: '/movies', icon: Film, section: 'primary', showInBottomTab: true },
  { id: 'series', label: 'Series', path: '/series', icon: Tv, section: 'primary', showInBottomTab: true },
  { id: 'anime', label: 'Anime', path: '/anime', icon: Star, section: 'primary', showInBottomTab: true },
  { id: 'livetv', label: 'Live TV', path: '/livetv', icon: Radio, section: 'primary', showInBottomTab: true },
  { id: 'watchlist', label: 'Watchlist', path: '/watchlist', icon: Bookmark, section: 'primary', showInBottomTab: false },
  { id: 'browse', label: 'Browse', path: '/browse', icon: LayoutGrid, section: 'primary', showInBottomTab: false },
  { id: 'search', label: 'Search', path: '/search', icon: Search, section: 'primary', showInBottomTab: true },
  { id: 'settings', label: 'Settings', path: '/settings', icon: Settings, section: 'secondary', showInBottomTab: false },
  { id: 'about', label: 'About', path: '/about', icon: Info, section: 'secondary', showInBottomTab: false },
  { id: 'how-it-works', label: 'How It Works', path: '/reverse-engineering', icon: Code, section: 'secondary', showInBottomTab: false },
];

export const PRIMARY_NAV_ITEMS = NAV_ITEMS.filter(item => item.section === 'primary');
export const SECONDARY_NAV_ITEMS = NAV_ITEMS.filter(item => item.section === 'secondary');
export const BOTTOM_TAB_ITEMS = NAV_ITEMS.filter(item => item.showInBottomTab);
