import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Leaf, ShieldCheck, BarChart3, FileSearch } from "lucide-react";
import { login } from "../api";

const FEATURES = [
  {
    icon: FileSearch,
    title: "Multi-source ingestion",
    desc: "SAP MB51, Green Button utility CSV, Concur travel exports — parsed and normalised automatically.",
  },
  {
    icon: BarChart3,
    title: "GHG Protocol aligned",
    desc: "Scope 1, 2, and 3 classification with unit normalisation to canonical SI units.",
  },
  {
    icon: ShieldCheck,
    title: "Audit-ready",
    desc: "Immutable raw records, review workflow, append-only audit trail for every status change.",
  },
];

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("analyst");
  const [password, setPassword] = useState("analyst123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      navigate("/dashboard");
    } catch {
      setError("Invalid username or password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left — brand panel */}
      <div className="hidden lg:flex flex-col w-[52%] bg-gray-900 p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-950 via-gray-900 to-brand-950 opacity-90" />
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "32px 32px",
          }}
        />

        <div className="relative z-10 flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-16">
            <div className="w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center shadow-lg">
              <Leaf className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-white text-base">Breathe ESG</p>
              <p className="text-xs text-gray-400">Emissions Data Platform</p>
            </div>
          </div>

          {/* Headline */}
          <div className="flex-1 flex flex-col justify-center">
            <h2 className="text-4xl font-bold text-white leading-tight mb-4">
              Enterprise-grade
              <br />
              <span className="text-brand-400">GHG data ingestion</span>
            </h2>
            <p className="text-gray-400 text-sm leading-relaxed mb-10 max-w-sm">
              Ingest emissions activity data from three enterprise sources, normalise to a canonical
              schema, and surface a review workflow before records are locked for audit.
            </p>

            <div className="space-y-5">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex items-start gap-4">
                  <div className="w-9 h-9 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-brand-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{title}</p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-gray-600">
            Aligned with GHG Protocol Corporate Standard (2015 edition)
          </p>
        </div>
      </div>

      {/* Right — login form */}
      <div className="flex-1 flex items-center justify-center bg-gray-50 px-8">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex flex-col items-center mb-8 lg:hidden">
            <div className="w-12 h-12 rounded-2xl bg-brand-500 flex items-center justify-center mb-3">
              <Leaf className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Breathe ESG</h1>
            <p className="text-sm text-gray-500 mt-1">Emissions Data Ingestion</p>
          </div>

          <div className="hidden lg:block mb-8">
            <h3 className="text-2xl font-bold text-gray-900">Sign in</h3>
            <p className="text-sm text-gray-500 mt-1">Access the analyst dashboard</p>
          </div>

          <div className="card p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input
                  className="input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                  required
                  autoComplete="username"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              {error && (
                <p className="text-sm text-red-600 font-medium">{error}</p>
              )}
              <button
                type="submit"
                className="btn-primary w-full justify-center"
                disabled={loading}
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </form>

            <div className="mt-5 p-3 bg-gray-50 rounded-lg border border-gray-100 text-xs text-gray-600 space-y-1">
              <p className="font-semibold text-gray-700 mb-1.5">Demo credentials</p>
              <button
                type="button"
                onClick={() => { setUsername("analyst"); setPassword("analyst123"); }}
                className="flex items-center justify-between w-full px-2 py-1.5 rounded hover:bg-white border border-transparent hover:border-gray-200 transition-colors"
              >
                <span className="font-mono">analyst / analyst123</span>
                <span className="text-gray-400">analyst role</span>
              </button>
              <button
                type="button"
                onClick={() => { setUsername("admin"); setPassword("admin123"); }}
                className="flex items-center justify-between w-full px-2 py-1.5 rounded hover:bg-white border border-transparent hover:border-gray-200 transition-colors"
              >
                <span className="font-mono">admin / admin123</span>
                <span className="text-gray-400">superuser</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
