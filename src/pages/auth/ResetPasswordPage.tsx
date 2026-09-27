import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Check, AlertCircle, Loader2 } from 'lucide-react';
import AuthLayout from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setChecking(false);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setSuccess(true);
      setTimeout(() => navigate('/app'), 2000);
    } catch (err: any) {
      setError(err.message ?? 'Failed to update password');
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasSession) {
    return (
      <AuthLayout>
        <div className="rounded-lg border bg-card p-6 shadow-sm text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-destructive" />
          <h2 className="text-lg font-semibold text-foreground">Invalid or expired link</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This password reset link has expired or is invalid. Please request a new one.
          </p>
          <Button
            size="lg"
            variant="outline"
            className="mt-4"
            onClick={() => navigate('/forgot-password')}
          >
            Request new link
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        {success ? (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg border bg-muted">
              <Check size={20} className="text-foreground" />
            </div>
            <p className="font-medium text-foreground">Password updated</p>
            <p className="mt-1 text-sm text-muted-foreground">Redirecting you to the app…</p>
          </div>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-foreground">Set new password</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your new password below.
            </p>

            {error && (
              <p className="mt-4 text-sm text-destructive">{error}</p>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  required
                  autoFocus
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  required
                  placeholder="Repeat your new password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>

              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading && <Loader2 className="animate-spin" />}
                Update password
              </Button>
            </form>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
