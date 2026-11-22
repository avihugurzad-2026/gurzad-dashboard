import { lazy, useEffect, useRef, type ComponentType } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { initPwa } from './lib/pwa';
import { MotionConfig } from 'motion/react';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { initStore, onStoreError, useStoreReady } from './data/store';
import { AppShell } from './layout/AppShell';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
// Every area loads on first visit, so the app opens with only the overview's code (was one 550KB file).
const page = <K extends string>(load: () => Promise<Record<K, ComponentType<any>>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const Notifications = page(() => import('./pages/Notifications'), 'Notifications');
const Planner = page(() => import('./pages/Planner'), 'Planner');
const HomeArea = page(() => import('./pages/home/HomeArea'), 'HomeArea');
const BusinessArea = page(() => import('./pages/business/BusinessArea'), 'BusinessArea');
const MarketingArea = page(() => import('./pages/marketing/MarketingArea'), 'MarketingArea');
const InvestArea = page(() => import('./pages/invest/InvestArea'), 'InvestArea');
const AlertRules = page(() => import('./pages/invest/InvestArea'), 'AlertRules');
const Property = page(() => import('./pages/invest/InvestArea'), 'Property');
const SettingsPage = page(() => import('./pages/Tools'), 'SettingsPage');
const Status = page(() => import('./pages/Tools'), 'Status');
const Team = page(() => import('./pages/Tools'), 'Team');
const WhatsApp = page(() => import('./pages/Tools'), 'WhatsApp');
/** After the first screen is up, fetch the other areas in the background so swiping to them is instant. */
let prefetched = false;
const prefetch = () => {
  if (prefetched) return; prefetched = true;
  for (const l of [() => import('./pages/home/HomeArea'), () => import('./pages/business/BusinessArea'), () => import('./pages/invest/InvestArea'), () => import('./pages/Planner')]) void l().catch(() => null); };
import { ToastProvider, useToast } from './ui/overlay';

const Router = import.meta.env.VITE_HASH_ROUTER ? HashRouter : BrowserRouter;

function Gate() {
  const { user, loading } = useAuth();
  const ready = useStoreReady();
  const toast = useToast();
  const nav = useNavigate();
  const navRef = useRef(nav); navRef.current = nav;
  useEffect(() => { initPwa((url) => navRef.current(url)); }, []);

  useEffect(() => { onStoreError(() => toast('השמירה נכשלה והשינוי בוטל. בדוק את החיבור ונסה שוב.')); }, [toast]);
  useEffect(() => { if (user) void initStore().catch(() => toast('טעינת הנתונים נכשלה')); }, [user, toast]);

  if (loading) return <Splash />;
  if (!user) return <Login />;
  if (!ready) return <Splash />;
  if (!prefetched) setTimeout(prefetch, 1500);

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="home/:tab?" element={<HomeArea />} />
        <Route path="business/:bizId?/:tab?" element={<BusinessArea />} />
        <Route path="invest" element={<InvestArea />} />
        <Route path="invest/alerts" element={<AlertRules />} />
        <Route path="invest/:propId/:tab?" element={<Property />} />
        <Route path="marketing/:tab?/:siteId?" element={<MarketingArea />} />
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
