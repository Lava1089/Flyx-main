'use client';

import { ReactNode } from 'react';
import { AdminProvider } from '../context/AdminContext';
import {
  RealtimeSliceProvider,
  UserSliceProvider,
  SSEConnectionProvider,
} from '../context/slices';
import AdminSidebar from './AdminSidebar';
import AdminHeader from './AdminHeader';
import UnifiedStatsBar from './UnifiedStatsBar';
import ResponsiveLayout from './ResponsiveLayout';

export default function AdminLayout({ children }: { children: ReactNode }) {
    return (
        <AdminProvider>
            <RealtimeSliceProvider>
                <UserSliceProvider>
                    <SSEConnectionProvider>
                        <ResponsiveLayout
                            sidebar={<AdminSidebar />}
                        >
                            <AdminHeader />
                            <UnifiedStatsBar />
                            <main
                                style={{
                                    flex: 1,
                                    padding: '32px',
                                    overflowY: 'auto',
                                    minWidth: 0,
                                }}
                                role="main"
                                aria-label="Admin panel main content"
                            >
                                {children}
                            </main>
                        </ResponsiveLayout>
                    </SSEConnectionProvider>
                </UserSliceProvider>
            </RealtimeSliceProvider>
        </AdminProvider>
    );
}
