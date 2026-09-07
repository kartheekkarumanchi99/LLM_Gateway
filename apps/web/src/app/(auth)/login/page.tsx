import { AuthForm } from '@/components/auth-form';
import { loginAction } from '@/lib/auth-actions';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return <AuthForm mode="login" action={loginAction} />;
}
