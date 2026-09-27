import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, User } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import AuthLayout from '@/components/layout/AuthLayout';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';

export default function SignUpPage() {
  const navigate = useNavigate();
  const signUp = useAuthStore((s) => s.signUp);

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  function validate(): string | null {
    if (password.length < 8) {
      return 'Password must be at least 8 characters.';
    }
    if (password !== confirmPassword) {
      return 'Passwords do not match.';
    }
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    try {
      await signUp(email, password, displayName);
      setSuccess(true);
      setTimeout(() => navigate('/login', { replace: true }), 3000);
    } catch (err: any) {
      setError(err?.message ?? 'Unable to create account. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <AuthLayout>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
            <svg
              className="h-6 w-6 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-gray-900">Account created</h1>
          <p className="mt-2 text-sm text-gray-500">
            Check your email for a confirmation link, then sign in.
          </p>
          <Link
            to="/login"
            className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Go to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">Create your account</h1>
        <p className="mt-1 text-sm text-gray-500">
          Get started with LabNote in seconds.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Input
            label="Display name"
            type="text"
            required
            placeholder="Jane Smith"
            autoComplete="name"
            icon={<User size={16} />}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />

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
            autoComplete="new-password"
            helperText="Must be at least 8 characters"
            icon={<Lock size={16} />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <Input
            label="Confirm password"
            type="password"
            required
            placeholder="••••••••"
            autoComplete="new-password"
            icon={<Lock size={16} />}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />

          <Button type="submit" fullWidth loading={loading}>
            Create account
          </Button>
        </form>
      </div>

      <p className="mt-6 text-center text-sm text-gray-500">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-blue-600 hover:text-blue-700">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
