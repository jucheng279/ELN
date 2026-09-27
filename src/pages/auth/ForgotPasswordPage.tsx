import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import AuthLayout from '@/components/layout/AuthLayout';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';

export default function ForgotPasswordPage() {
  const resetPassword = useAuthStore((s) => s.resetPassword);

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await resetPassword(email);
      setSent(true);
    } catch (err: any) {
      setError(err?.message ?? 'Unable to send reset link. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {sent ? (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
              <Mail size={22} className="text-blue-600" />
            </div>
            <h1 className="text-lg font-semibold text-gray-900">Check your email</h1>
            <p className="mt-2 text-sm text-gray-500">
              If an account exists for <span className="font-medium text-gray-700">{email}</span>,
              you'll receive a password reset link shortly.
            </p>
            <Link
              to="/login"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              <ArrowLeft size={14} />
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-gray-900">Reset your password</h1>
            <p className="mt-1 text-sm text-gray-500">
              Enter your email and we'll send you a reset link.
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

              <Button type="submit" fullWidth loading={loading}>
                Send reset link
              </Button>
            </form>

            <div className="mt-4 text-center">
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                <ArrowLeft size={14} />
                Back to sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
