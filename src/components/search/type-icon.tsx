import { ArrowLeftRight, Building2, CalendarDays, CheckSquare, FileText, Gavel, Home, Inbox, MapPin, Target, TrendingUp, Users } from 'lucide-react';
import type { SearchType } from '@/server/search';

// One icon per search result type (used by the ⌘K palette and the search page)
const ICONS: Record<SearchType, typeof FileText> = {
  task: CheckSquare, client: Users, document: FileText, entity: Building2, branch: MapPin, goal: Target,
  property: Home, investment: TrendingUp, legal: Gavel, event: CalendarDays, transaction: ArrowLeftRight, inbox: Inbox,
};

export function TypeIcon({ type, className = 'size-4' }: { type: SearchType; className?: string }) {
  const I = ICONS[type] ?? FileText;
  return <I className={className} aria-hidden />;
}
