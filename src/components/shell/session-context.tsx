'use client';
import { createContext, useContext } from 'react';
import { setLocations, type LocationRow } from '@/lib/places';

// What the client needs to know about the signed-in user: who they are, which places they may
// add things to, the people they can hand tasks to, and which nav links to show. The server
// enforces all of this again on every read and write; this only shapes the screens.
export type ClientSession = {
  user: { id: string; name: string; isOwner: boolean; isAdmin: boolean };
  places: string[];                      // encoded places (domain|branch|location) the user may add tasks in
  people: { id: string; name: string }[]; // active users a task can be assigned to
  hrefs: string[];                        // nav links the user may open
  locations?: LocationRow[];              // the branch registry (DB `locations`), loaded on the server
};

const Ctx = createContext<ClientSession | null>(null);

export function SessionProvider({ value, children }: { value: ClientSession; children: React.ReactNode }) {
  // Before any child renders, so nav, breadcrumb and place menus see the same branches as the server.
  // Idempotent (no-op when the rows did not change).
  if (value.locations) setLocations(value.locations);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
