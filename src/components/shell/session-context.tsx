'use client';
import { createContext, useContext } from 'react';

// What the client needs to know about the signed-in user: who they are, which places they may
// add things to, the people they can hand tasks to, and which nav links to show. The server
// enforces all of this again on every read and write; this only shapes the screens.
export type ClientSession = {
  user: { id: string; name: string; isOwner: boolean; isAdmin: boolean };
  places: string[];                      // encoded places (domain|branch|location) the user may add tasks in
  people: { id: string; name: string }[]; // active users a task can be assigned to
  hrefs: string[];                        // nav links the user may open
};

const Ctx = createContext<ClientSession | null>(null);

export function SessionProvider({ value, children }: { value: ClientSession; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
