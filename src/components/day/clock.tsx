'use client';
import { useEffect, useState } from 'react';

const date = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jerusalem' });
const time = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jerusalem' });
const hour = (d: Date) => Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Jerusalem' }).format(d));
function greeting(d: Date) {
  const h = hour(d);
  return h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב';
}

// "ערב טוב, אביהו" with today's date and a live clock, in Israel time whatever the device's zone
export function GreetingClock({ name, initial }: { name: string; initial: string }) {
  const [now, setNow] = useState(() => new Date(initial));
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h1 className="text-title font-bold text-ink">{greeting(now)}, {name}</h1>
      <p className="text-body text-muted">{date.format(now)} · <time className="tabular" dateTime={now.toISOString()}>{time.format(now)}</time></p>
    </div>
  );
}
