import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Mail } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import AuthLayout from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to send reset link. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        {sent ? (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg border bg-muted">
              <Mail size={20} className="text-foreground" />
            </div>
            <h1 className="text-lg font-semibold text-foreground">Check your email</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              If an account exists for{' '}
              <span className="font-medium text-foreground">{email}</span>, you'll
              receive a password reset link shortly.
            </p>
            <Link
              to="/login"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline"
            >
              <ArrowLeft size={14} />
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-foreground">Reset your password</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your email and we'll send you a reset link.
            </p>

            {error && (
              <p className="mt-4 text-sm text-destructive">{error}</p>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  placeholder="you@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading && <Loader2 className="animate-spin" />}
                Send reset link
              </Button>
            </form>

            <div className="mt-4 text-center">
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
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
