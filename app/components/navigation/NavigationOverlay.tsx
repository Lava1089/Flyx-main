'use client';

import { usePathname } from 'next/navigation';
import { useViewport } from '@/hooks/useViewport';
import { useSidebarState } from '@/hooks/useSidebarState';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { SidebarNav } from './SidebarNav';
import { BottomTabBar } from './BottomTabBar';
import { CommandPalette } from './CommandPalette';

/**
 * Renders navigation elements as fixed overlays WITHOUT wrapping children.
 * Also injects a <style> tag to offset the body margin for the sidebar.
 * Both sidebar and body offset share the same useSidebarState instance
 * so collapsing the sidebar immediately updates the body margin.
 */
export function NavigationOverlay() {
  const pathname = usePathname() ?? '/';
  const viewport = useViewport();
  const { collapsed, toggle } = useSidebarState();
  const { open: cmdOpen, setOpen: setCmdOpen } = useCommandPalette();

  const isWatchMode = pathname.startsWith('/watch/') || pathname === '/watch';
  const isAdminRoute = pathname.startsWith('/admin');
  const isMobile = viewport === 'mobile';

  // Compute body offset based on shared state
  let marginLeft = '0px';
  let paddingBottom = '0px';

  if (!isAdminRoute && !isWatchMode) {
    if (isMobile) {
      paddingBottom = 'var(--bottom-tab-height)';
    } else if (collapsed) {
      marginLeft = 'var(--sidebar-collapsed-width)';
    } else {
      marginLeft = 'var(--sidebar-width)';
    }
  }

  return (
    <>
      <style>{`
        body {
          margin-left: ${marginLeft} !important;
          padding-bottom: ${paddingBottom} !important;
          transition: margin-left 200ms cubic-bezier(0.4, 0, 0.2, 1);
        }
      `}</style>

      {!isAdminRoute && !isWatchMode && !isMobile && (
        <SidebarNav
          collapsed={collapsed}
          onToggleCollapse={toggle}
          currentPath={pathname}
        />
      )}

      {!isAdminRoute && !isWatchMode && isMobile && (
        <BottomTabBar currentPath={pathname} />
      )}

      {!isAdminRoute && !isWatchMode && (
        <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      )}
    </>
  );
}
