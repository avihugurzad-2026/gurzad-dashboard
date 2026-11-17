import { useEffect, useRef } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { initPwa } from './lib/pwa';
import { MotionConfig } from 'motion/react';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { initStore, onStoreError, useStoreReady } from './data/store';
import { AppShell } from './layout/AppShell';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Notifications } from './pages/Notifications';
import { Planner } from './pages/Planner';
import { HomeArea } from './pages/home/HomeArea';
import { BusinessArea } from './pages/business/BusinessArea';
import { AlertRules, InvestArea, Property } from './pages/invest/InvestArea';
import { SettingsPage, Status, Team, WhatsApp } from './pages/Tools';
import { ToastProvider, useToast } from './ui/overlay';

const Router = import.meta.env.VITE_HASH_ROUTER ? HashRouter : BrowserRouter;

function Gate() {
  const { user, loading } = useAuth();
  const ready = useStoreReady();
  const toast = useToast();
  const nav = useNavigate();
  const navRef = useRef(nav); navRef.current = nav;
  useEffect(() => { initPwa((url) => navRef.current(url)); }, []);

  useEffect(() => { onStoreError(() => toast('השמירה נכשלה. בדוק את החיבור ונסה שוב.')); }, [toast]);
  useEffect(() => { if (user) void initStore().catch(() => toast('טעינת הנתונים נכשלה')); }, [user, toast]);

  if (loading) return <Splash />;
  if (!user) return <Login />;
  if (!ready) return <Splash />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="home/:tab?" element={<HomeArea />} />
        <Route path="business/:bizId?/:tab?" element={<BusinessArea />} />
        <Route path="invest" element={<InvestArea />} />
        <Route path="invest/alerts" element={<AlertRules />} />
        <Route path="invest/:propId/:tab?" element={<Property />} />
        <Route path="planner/:view?" element={<Planner />} />
        <Route path="whatsapp" element={<WhatsApp />} />
        <Route path="status" element={<Status />} />
        <Route path="team" element={<Team />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function Splash() {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }} aria-busy="true" aria-label="טוען">
      <div className="brand-mark" style={{ width: 56, height: 56, borderRadius: 18 }}><span className="pulse" style={{ background: 'var(--lime)' }} /></div>
    </div>
  );
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Router>
        <AuthProvider>
          <ToastProvider>
            <Gate />
          </ToastProvider>
        </AuthProvider>
      </Router>
    </MotionConfig>
  );
}
