import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import AuthLayout from '@/components/layout/AuthLayout';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';

export default function LoginPage() {
  const navigate = useNavigate();
  const signIn = useAuthStore((s) => s.signIn);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await signIn(email, password);
      navigate('/workspaces', { replace: true });
    } catch (err: any) {
      setError(err?.message ?? 'Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">Sign in to your account</h1>
        <p className="mt-1 text-sm text-gray-500">
          Welcome back. Enter your credentials to continue.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Input
            label="Email"
            type="email"
            required
            placeholder="you@example.com"
            autoComplete="email"
            icon={<Mail size={16} />}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <Input
            label="Password"
            type="password"
            required
            placeholder="••••••••"
            autoComplete="current-password"
            icon={<Lock size={16} />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <div className="flex justify-end">
            <Link
              to="/forgot-password"
              className="text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Forgot password?
            </Link>
          </div>

          <Button type="submit" fullWidth loading={loading}>
            Sign in
          </Button>
        </form>
      </div>

      <p className="mt-6 text-center text-sm text-gray-500">
        Don&apos;t have an account?{' '}
        <Link to="/signup" className="font-medium text-blue-600 hover:text-blue-700">
          Create one
        </Link>
      </p>
    </AuthLayout>
  );
}
