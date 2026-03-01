'use client';

import { usePathname } from 'next/navigation';
import { useViewport } from '@/hooks/useViewport';
import { useSidebarState } from '@/hooks/useSidebarState';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { SidebarNav } from './SidebarNav';
import { BottomTabBar } from './BottomTabBar';
import { CommandPalette } from './CommandPalette';
import styles from './navigation.module.css';

export interface NavigationShellProps {
  children: React.ReactNode;
}

/**
 * Root layout wrapper that conditionally renders navigation based on
 * viewport size and current route.
 *
 * Uses margin-left on the shell div to offset content away from the
 * fixed sidebar.
 */
export function NavigationShell({ children }: NavigationShellProps) {
  const pathname = usePathname() ?? '/';
  const viewport = useViewport();
  const { collapsed, toggle } = useSidebarState();
  const { open: cmdOpen, setOpen: setCmdOpen } = useCommandPalette();

  const isWatchMode = pathname.startsWith('/watch');
  const isAdminRoute = pathname.startsWith('/admin');

  // Admin routes have their own layout
  if (isAdminRoute) {
    return <>{children}</>;
  }

  const isMobile = viewport === 'mobile';

  // Shell class — margin-left pushes content away from fixed sidebar
  let shellClass = styles.shell;
  if (isWatchMode) {
    // no offset
  } else if (isMobile) {
    shellClass += ` ${styles.shellMobile}`;
  } else if (collapsed) {
    shellClass += ` ${styles.shellWithRail}`;
  } else {
    shellClass += ` ${styles.shellWithSidebar}`;
  }

  return (
    <div className={shellClass}>
      {!isWatchMode && !isMobile && (
        <SidebarNav
          collapsed={collapsed}
          onToggleCollapse={toggle}
          currentPath={pathname}
        />
      )}

      {children}

      {!isWatchMode && isMobile && (
        <BottomTabBar currentPath={pathname} />
      )}

      {!isWatchMode && (
        <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      )}
    </div>
  );
}

export default NavigationShell;
