import { redirect } from 'next/navigation';

// Tasks now live in each area (business, personal, ventures); personal is the default list
export default function TasksRedirect() {
  redirect('/personal/tasks');
}
