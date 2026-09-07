import { AuthForm } from '@/components/auth-form';
import { registerAction } from '@/lib/auth-actions';

export const dynamic = 'force-dynamic';

export default function RegisterPage() {
  return <AuthForm mode="register" action={registerAction} />;
}
