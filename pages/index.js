// pages/index.js — Trading Performance Dashboard (Next.js + Supabase)
import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, Legend } from 'recharts';
import { LayoutDashboard, Wallet, ArrowLeftRight, BookOpen, BarChart3, Plus, TrendingUp, TrendingDown, DollarSign, Target, Activity, X, Check, AlertCircle, Edit2, LogOut, User, Loader2 } from 'lucide-react';

export default function TradingDashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [accounts, setAccounts] = useState([]);
  const [trades, setTrades] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
      } else {
        setUser(session.user);
        await loadAllData();
      }
    };
    checkAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) router.push('/login');
      else setUser(session.user);
    });

    return () => authListener?.subscription.unsubscribe();
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    const [accRes, tradeRes, trfRes] = await Promise.all([
      supabase.from('accounts').select('*').order('created_at'),
      supabase.from('trades').select('*').order('close_date', { ascending: false }),
      supabase.from('transfers').select('*').order('date', { ascending: false }),
    ]);
    if (accRes.data) setAccounts(accRes.data);
    if (tradeRes.data) setTrades(tradeRes.data.map(t => ({
      ...t,
      openDate: t.open_date,
      closeDate: t.close_date,
      netProfit: t.net_profit,
    })));
    if (trfRes.data) setTransfers(trfRes.data.map(t => ({
      ...t,
      from: t.from_account,
      to: t.to_account,
    })));
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('trading-data-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, () => loadAllData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, () => loadAllData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transfers' }, () => loadAllData())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [user]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const totalCapital = useMemo(() => accounts.reduce((sum, a) => sum + Number(a.balance), 0), [accounts]);

  const getAccountStats = (accountId) => {
    const accountTrades = trades.filter(t => t.account === accountId && t.status === 'Closed');
    if (accountTrades.length === 0) return { winRate: 0, profitFactor: 0, totalPnL: 0, trades: 0 };
    const winners = accountTrades.filter(t => t.outcome === 'Winner');
    const losers = accountTrades.filter(t => t.outcome === 'Loser');
    const totalWins = winners.reduce((s, t) => s + Number(t.netProfit), 0);
    const totalLosses = Math.abs(losers.reduce((s, t) => s + Number(t.netProfit), 0));
    return {
      winRate: (winners.length / accountTrades.length) * 100,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? 999 : 0),
      totalPnL: accountTrades.reduce((s, t) => s + Number(t.netProfit), 0),
      trades: accountTrades.length,
    };
  };

  const evolutionData = useMemo(() => {
    const dates = [...new Set(trades.filter(t => t.status === 'Closed').map(t => t.closeDate))].sort();
    let cumul = 0;
    return dates.map(date => {
      const dayProfit = trades.filter(t => t.closeDate === date && t.status === 'Closed').reduce((s, t) => s + Number(t.netProfit), 0);
      cumul += dayProfit;
      return { date, value: cumul };
    });
  }, [trades]);

  const formatMoney = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  const formatMoneyDecimal = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  const handleTransfer = async (data) => {
    const amount = parseFloat(data.amount);
    await supabase.from('transfers').insert({ date: data.date, from_account: data.from, to_account: data.to, amount, note: data.note });
    const fromAcc = accounts.find(a => a.id === data.from);
    const toAcc = accounts.find(a => a.id === data.to);
    await supabase.from('accounts').update({ balance: Number(fromAcc.balance) - amount }).eq('id', data.from);
    await supabase.from('accounts').update({ balance: Number(toAcc.balance) + amount }).eq('id', data.to);
    setShowTransferModal(false);
    await loadAllData();
  };

  const handleAddTrade = async (data) => {
    const netProfit = parseFloat(data.netProfit) || 0;
    const fees = parseFloat(data.fees) || 0;
    const mise = parseFloat(data.mise) || 0;
    await supabase.from('trades').insert({
      ticker: data.ticker, account: data.account, open_date: data.openDate, close_date: data.closeDate,
      type: data.type, side: data.side, entry: parseFloat(data.entry) || 0, exit: parseFloat(data.exit) || 0,
      quantity: parseFloat(data.quantity) || 0, net_profit: netProfit, setup: data.setup, outcome: data.outcome,
      status: data.status, mise, levier: parseFloat(data.levier) || 1, position: parseFloat(data.position) || 0,
      roi: mise > 0 ? (netProfit / mise) * 100 : 0, fees,
    });
    const acc = accounts.find(a => a.id === data.account);
    await supabase.from('accounts').update({ balance: Number(acc.balance) + netProfit }).eq('id', data.account);
    if (fees > 0) {
      const fraisAcc = accounts.find(a => a.id === 'frais');
      if (fraisAcc) await supabase.from('accounts').update({ balance: Number(fraisAcc.balance) - fees }).eq('id', 'frais');
    }
    setShowTradeModal(false);
    await loadAllData();
  };

  const handleSaveAccount = async (data) => {
    if (editingAccount) {
      await supabase.from('accounts').update({ name: data.name, emoji: data.emoji, balance: parseFloat(data.balance) || 0, goal: parseFloat(data.goal) || 0, color: data.color }).eq('id', editingAccount.id);
    } else {
      await supabase.from('accounts').insert({ id: `account_${Date.now()}`, name: data.name, emoji: data.emoji, balance: parseFloat(data.balance) || 0, goal: parseFloat(data.goal) || 0, color: data.color, type: 'trading' });
    }
    setShowAccountModal(false);
    setEditingAccount(null);
    await loadAllData();
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Chargement de vos données...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="w-60 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-5 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-slate-900 text-sm">Trading Journal</h1>
              <p className="text-xs text-slate-500">Performance Dashboard</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
            { id: 'accounts', label: 'Comptes', icon: Wallet },
            { id: 'transfers', label: 'Virements', icon: ArrowLeftRight },
            { id: 'trades', label: 'Journal de trades', icon: BookOpen },
            { id: 'analytics', label: 'Analyses', icon: BarChart3 },
          ].map(item => (
            <button key={item.id} onClick={() => setActiveTab(item.id)} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${activeTab === item.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              <item.icon className="w-4 h-4" />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="bg-gradient-to-br from-slate-900 to-slate-700 rounded-xl p-4 text-white">
            <p className="text-xs text-slate-300 mb-1">Capital total</p>
            <p className="text-xl font-bold">{formatMoney(totalCapital)}</p>
          </div>
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <User className="w-3.5 h-3.5 text-emerald-700" />
              </div>
              <p className="text-xs text-slate-700 truncate">{user.email}</p>
            </div>
            <button onClick={handleLogout} className="p-1.5 hover:bg-slate-100 rounded-lg" title="Déconnexion">
              <LogOut className="w-3.5 h-3.5 text-slate-500" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="p-8 max-w-7xl mx-auto">
          {activeTab === 'dashboard' && <DashboardView accounts={accounts} trades={trades} evolutionData={evolutionData} totalCapital={totalCapital} formatMoney={formatMoney} formatMoneyDecimal={formatMoneyDecimal} />}
          {activeTab === 'accounts' && <AccountsView accounts={accounts} getAccountStats={getAccountStats} formatMoney={formatMoney} formatMoneyDecimal={formatMoneyDecimal} onAdd={() => { setEditingAccount(null); setShowAccountModal(true); }} onEdit={(a) => { setEditingAccount(a); setShowAccountModal(true); }} />}
          {activeTab === 'transfers' && <TransfersView transfers={transfers} accounts={accounts} formatMoneyDecimal={formatMoneyDecimal} onNew={() => setShowTransferModal(true)} />}
          {activeTab === 'trades' && <TradesView trades={trades} accounts={accounts} formatMoneyDecimal={formatMoneyDecimal} onNew={() => setShowTradeModal(true)} />}
          {activeTab === 'analytics' && <AnalyticsView trades={trades} accounts={accounts} formatMoney={formatMoney} formatMoneyDecimal={formatMoneyDecimal} getAccountStats={getAccountStats} />}
        </div>
      </main>

      {showTransferModal && <TransferModal accounts={accounts} onClose={() => setShowTransferModal(false)} onSubmit={handleTransfer} formatMoneyDecimal={formatMoneyDecimal} />}
      {showTradeModal && <TradeModal accounts={accounts} onClose={() => setShowTradeModal(false)} onSubmit={handleAddTrade} />}
      {showAccountModal && <AccountModal account={editingAccount} onClose={() => { setShowAccountModal(false); setEditingAccount(null); }} onSubmit={handleSaveAccount} />}
    </div>
  );
}

function DashboardView({ accounts, trades, evolutionData, totalCapital, formatMoney, formatMoneyDecimal }) {
  const closedTrades = trades.filter(t => t.status === 'Closed');
  const totalPnL = closedTrades.reduce((s, t) => s + Number(t.netProfit), 0);
  const winners = closedTrades.filter(t => t.outcome === 'Winner');
  const globalWinRate = closedTrades.length > 0 ? (winners.length / closedTrades.length) * 100 : 0;
  const totalWins = winners.reduce((s, t) => s + Number(t.netProfit), 0);
  const totalLosses = Math.abs(closedTrades.filter(t => t.outcome === 'Loser').reduce((s, t) => s + Number(t.netProfit), 0));
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;
  const pieData = accounts.filter(a => a.type === 'trading' && Number(a.balance) > 0).map(a => ({ name: a.name, value: Number(a.balance), color: a.color }));

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Dashboard</h2>
          <p className="text-sm text-slate-500 mt-1">Vue d'ensemble de votre performance</p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4 mb-8">
        <KPICard label="Capital total" value={formatMoney(totalCapital)} icon={DollarSign} color="emerald" />
        <KPICard label="P&L global" value={formatMoney(totalPnL)} icon={totalPnL >= 0 ? TrendingUp : TrendingDown} color={totalPnL >= 0 ? 'emerald' : 'red'} />
        <KPICard label="Win Rate" value={`${globalWinRate.toFixed(1)}%`} icon={Target} color="blue" />
        <KPICard label="Profit Factor" value={profitFactor.toFixed(2)} icon={Activity} color="purple" />
      </div>
      <div className="bg-white rounded-2xl p-6 border border-slate-200 mb-6">
        <div className="mb-6">
          <h3 className="font-semibold text-slate-900">Évolution du capital</h3>
          <p className="text-xs text-slate-500 mt-1">Total Asset Value au fil du temps</p>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={evolutionData}>
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
            <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${(v/1000).toFixed(0)}k$`} />
            <Tooltip formatter={(v) => formatMoneyDecimal(v)} contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }} />
            <Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2.5} fill="url(#colorValue)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 border border-slate-200">
          <h3 className="font-semibold text-slate-900 mb-4">Répartition par portefeuille</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value">
                {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip formatter={(v) => formatMoney(v)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-2xl p-6 border border-slate-200">
          <h3 className="font-semibold text-slate-900 mb-4">Derniers trades</h3>
          <div className="space-y-2">
            {trades.slice(0, 5).map(t => (
              <div key={t.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold ${t.outcome === 'Winner' ? 'bg-emerald-100 text-emerald-700' : t.outcome === 'Loser' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}>
                    {t.ticker.substring(0, 3)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900">{t.ticker}</p>
                    <p className="text-xs text-slate-500">{t.closeDate} · {t.setup}</p>
                  </div>
                </div>
                <p className={`text-sm font-semibold ${Number(t.netProfit) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {Number(t.netProfit) >= 0 ? '+' : ''}{formatMoneyDecimal(Number(t.netProfit))}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountsView({ accounts, getAccountStats, formatMoney, formatMoneyDecimal, onAdd, onEdit }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Comptes</h2>
          <p className="text-sm text-slate-500 mt-1">Vos portefeuilles de trading</p>
        </div>
        <button onClick={onAdd} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 flex items-center gap-2">
          <Plus className="w-4 h-4" /> Nouveau compte
        </button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {accounts.map(a => {
          const stats = getAccountStats(a.id);
          const goalProgress = Number(a.goal) > 0 ? Math.min((Number(a.balance) / Number(a.goal)) * 100, 100) : 0;
          return (
            <div key={a.id} className="bg-white rounded-2xl p-5 border border-slate-200 hover:shadow-md transition group">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{a.emoji}</span>
                  <h3 className="font-semibold text-slate-900">{a.name}</h3>
                </div>
                <button onClick={() => onEdit(a)} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-100 rounded">
                  <Edit2 className="w-3.5 h-3.5 text-slate-500" />
                </button>
              </div>
              <p className={`text-2xl font-bold mb-4 ${Number(a.balance) >= 0 ? 'text-slate-900' : 'text-red-600'}`}>{formatMoneyDecimal(Number(a.balance))}</p>
              {a.type === 'trading' && (
                <>
                  <div className="space-y-2 mb-3">
                    <div className="flex justify-between text-xs"><span className="text-slate-500">Win Rate</span><span className="font-semibold">{stats.winRate.toFixed(1)}%</span></div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5"><div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${stats.winRate}%` }} /></div>
                  </div>
                  <div className="flex justify-between text-xs mb-3"><span className="text-slate-500">Profit Factor</span><span className="font-semibold">{stats.profitFactor === 999 ? '∞' : stats.profitFactor.toFixed(2)}</span></div>
                  {Number(a.goal) > 0 && (
                    <div>
                      <div className="flex justify-between text-xs mb-1"><span className="text-slate-500">Objectif {formatMoney(Number(a.goal))}</span><span className="font-semibold">{goalProgress.toFixed(0)}%</span></div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5"><div className="rounded-full h-1.5" style={{ width: `${Math.max(goalProgress, 0)}%`, background: a.color }} /></div>
                    </div>
                  )}
                  <div className="flex justify-between text-xs mt-3 pt-3 border-t border-slate-100">
                    <span className="text-slate-500">{stats.trades} trades</span>
                    <span className={`font-semibold ${stats.totalPnL >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{stats.totalPnL >= 0 ? '+' : ''}{formatMoney(stats.totalPnL)}</span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TransfersView({ transfers, accounts, formatMoneyDecimal, onNew }) {
  const getAccount = (id) => accounts.find(a => a.id === id);
  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div><h2 className="text-2xl font-bold text-slate-900">Virements</h2><p className="text-sm text-slate-500 mt-1">Mouvements entre vos comptes</p></div>
        <button onClick={onNew} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 flex items-center gap-2"><Plus className="w-4 h-4" /> Nouveau virement</button>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-600 uppercase">Date</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-600 uppercase">Source</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-600 uppercase">Destination</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-600 uppercase">Note</th>
              <th className="text-right px-6 py-3 text-xs font-semibold text-slate-600 uppercase">Montant</th>
            </tr>
          </thead>
          <tbody>
            {transfers.map(t => {
              const from = getAccount(t.from);
              const to = getAccount(t.to);
              return (
                <tr key={t.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-6 py-4 text-sm text-slate-700">{t.date}</td>
                  <td className="px-6 py-4"><div className="flex items-center gap-2"><span>{from?.emoji}</span><span className="text-sm font-medium">{from?.name}</span></div></td>
                  <td className="px-6 py-4"><div className="flex items-center gap-2"><ArrowLeftRight className="w-3 h-3 text-slate-400" /><span>{to?.emoji}</span><span className="text-sm font-medium">{to?.name}</span></div></td>
                  <td className="px-6 py-4 text-sm text-slate-500">{t.note}</td>
                  <td className="px-6 py-4 text-sm font-semibold text-right">{formatMoneyDecimal(Number(t.amount))}</td>
                </tr>
              );
            })}
            {transfers.length === 0 && <tr><td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-500">Aucun virement</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TradesView({ trades, accounts, formatMoneyDecimal, onNew }) {
  const [filterAccount, setFilterAccount] = useState('all');
  const getAccount = (id) => accounts.find(a => a.id === id);
  const filtered = filterAccount === 'all' ? trades : trades.filter(t => t.account === filterAccount);
  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div><h2 className="text-2xl font-bold text-slate-900">Journal de trades</h2><p className="text-sm text-slate-500 mt-1">{filtered.length} trades enregistrés</p></div>
        <div className="flex items-center gap-3">
          <select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm">
            <option value="all">Tous les comptes</option>
            {accounts.filter(a => a.type === 'trading').map(a => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
          </select>
          <button onClick={onNew} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 flex items-center gap-2"><Plus className="w-4 h-4" /> Nouveau trade</button>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-xs font-semibold text-slate-600 uppercase">
                <th className="text-left px-4 py-3">Ticker</th><th className="text-left px-4 py-3">Compte</th><th className="text-left px-4 py-3">Date close</th><th className="text-left px-4 py-3">Side</th><th className="text-right px-4 py-3">Entry</th><th className="text-right px-4 py-3">Exit</th><th className="text-right px-4 py-3">Net P&L</th><th className="text-left px-4 py-3">Setup</th><th className="text-center px-4 py-3">Result</th><th className="text-right px-4 py-3">ROI %</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => {
                const acc = getAccount(t.account);
                const np = Number(t.netProfit);
                return (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{t.ticker}</td>
                    <td className="px-4 py-3 text-slate-600">{acc?.emoji} {acc?.name}</td>
                    <td className="px-4 py-3 text-slate-600">{t.closeDate}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${t.side === 'Buy' ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700'}`}>{t.side}</span></td>
                    <td className="px-4 py-3 text-right">{Number(t.entry)?.toLocaleString('fr-FR')}</td>
                    <td className="px-4 py-3 text-right">{Number(t.exit)?.toLocaleString('fr-FR')}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${np >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{np >= 0 ? '+' : ''}{formatMoneyDecimal(np)}</td>
                    <td className="px-4 py-3"><span className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700">{t.setup}</span></td>
                    <td className="px-4 py-3 text-center"><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${t.outcome === 'Winner' ? 'bg-emerald-100 text-emerald-700' : t.outcome === 'Loser' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}><span className={`w-1.5 h-1.5 rounded-full ${t.outcome === 'Winner' ? 'bg-emerald-500' : t.outcome === 'Loser' ? 'bg-red-500' : 'bg-slate-400'}`} />{t.outcome}</span></td>
                    <td className={`px-4 py-3 text-right font-medium ${Number(t.roi) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{Number(t.roi)?.toFixed(2)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AnalyticsView({ trades, accounts, formatMoney, formatMoneyDecimal, getAccountStats }) {
  const [analyticsTab, setAnalyticsTab] = useState('global');
  const tradingAccounts = accounts.filter(a => a.type === 'trading');
  const [selectedAccount, setSelectedAccount] = useState(tradingAccounts[0]?.id);
  const closedTrades = trades.filter(t => t.status === 'Closed');

  const bySetup = useMemo(() => {
    const map = {};
    closedTrades.forEach(t => { if (!map[t.setup]) map[t.setup] = { setup: t.setup, pnl: 0, count: 0 }; map[t.setup].pnl += Number(t.netProfit); map[t.setup].count += 1; });
    return Object.values(map);
  }, [closedTrades]);

  const byTicker = useMemo(() => {
    const map = {};
    closedTrades.forEach(t => { if (!map[t.ticker]) map[t.ticker] = { ticker: t.ticker, pnl: 0, count: 0 }; map[t.ticker].pnl += Number(t.netProfit); map[t.ticker].count += 1; });
    return Object.values(map).sort((a, b) => b.pnl - a.pnl);
  }, [closedTrades]);

  const byAccount = useMemo(() => tradingAccounts.map(a => {
    const t = closedTrades.filter(tr => tr.account === a.id);
    return { name: a.name, pnl: t.reduce((s, tr) => s + Number(tr.netProfit), 0), color: a.color };
  }), [closedTrades, tradingAccounts]);

  return (
    <div>
      <div className="mb-6"><h2 className="text-2xl font-bold text-slate-900">Analyses</h2><p className="text-sm text-slate-500 mt-1">Statistiques détaillées</p></div>
      <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-lg w-fit">
        {[{ id: 'global', label: 'Vue globale' }, { id: 'profile', label: 'Analyse par profil' }, { id: 'compare', label: 'Comparaison' }].map(t => (
          <button key={t.id} onClick={() => setAnalyticsTab(t.id)} className={`px-4 py-2 rounded-md text-sm font-medium ${analyticsTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>{t.label}</button>
        ))}
      </div>
      {analyticsTab === 'global' && (
        <div>
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div className="bg-white rounded-2xl p-6 border border-slate-200">
              <h3 className="font-semibold mb-4">P&L par portefeuille</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={byAccount}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => formatMoney(v)} />
                  <Bar dataKey="pnl" radius={[8, 8, 0, 0]}>{byAccount.map((e, i) => <Cell key={i} fill={e.pnl >= 0 ? e.color : '#ef4444'} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white rounded-2xl p-6 border border-slate-200">
              <h3 className="font-semibold mb-4">P&L par setup</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={bySetup}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="setup" stroke="#94a3b8" fontSize={11} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => formatMoney(v)} />
                  <Bar dataKey="pnl" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-slate-200">
            <h3 className="font-semibold mb-4">Performance par actif</h3>
            <div className="grid grid-cols-2 gap-3">
              {byTicker.map(t => (
                <div key={t.ticker} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div><p className="font-semibold text-sm">{t.ticker}</p><p className="text-xs text-slate-500">{t.count} trades</p></div>
                  <p className={`font-semibold text-sm ${t.pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{t.pnl >= 0 ? '+' : ''}{formatMoney(t.pnl)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {analyticsTab === 'profile' && <ProfileAnalysis accounts={accounts} trades={trades} selectedAccount={selectedAccount} setSelectedAccount={setSelectedAccount} getAccountStats={getAccountStats} formatMoney={formatMoney} formatMoneyDecimal={formatMoneyDecimal} />}
      {analyticsTab === 'compare' && <ProfileComparison accounts={accounts} getAccountStats={getAccountStats} formatMoney={formatMoney} formatMoneyDecimal={formatMoneyDecimal} />}
    </div>
  );
}

function ProfileAnalysis({ accounts, trades, selectedAccount, setSelectedAccount, getAccountStats, formatMoney, formatMoneyDecimal }) {
  const tradingAccounts = accounts.filter(a => a.type === 'trading');
  const account = accounts.find(a => a.id === selectedAccount);
  const accountTrades = trades.filter(t => t.account === selectedAccount && t.status === 'Closed');
  const stats = getAccountStats(selectedAccount);
  const winners = accountTrades.filter(t => t.outcome === 'Winner');
  const losers = accountTrades.filter(t => t.outcome === 'Loser');
  const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + Number(t.netProfit), 0) / winners.length : 0;
  const avgLoss = losers.length > 0 ? losers.reduce((s, t) => s + Number(t.netProfit), 0) / losers.length : 0;
  const bestTrade = accountTrades.length > 0 ? Math.max(...accountTrades.map(t => Number(t.netProfit))) : 0;
  const worstTrade = accountTrades.length > 0 ? Math.min(...accountTrades.map(t => Number(t.netProfit))) : 0;
  const expectancy = accountTrades.length > 0 ? accountTrades.reduce((s, t) => s + Number(t.netProfit), 0) / accountTrades.length : 0;

  const evolution = useMemo(() => {
    const dates = [...new Set(accountTrades.map(t => t.closeDate))].sort();
    let cumul = 0;
    return dates.map(date => { const dp = accountTrades.filter(t => t.closeDate === date).reduce((s, t) => s + Number(t.netProfit), 0); cumul += dp; return { date, value: cumul }; });
  }, [accountTrades]);

  const setupStats = useMemo(() => {
    const map = {};
    accountTrades.forEach(t => { if (!map[t.setup]) map[t.setup] = { setup: t.setup, pnl: 0, wins: 0, losses: 0, count: 0 }; map[t.setup].pnl += Number(t.netProfit); map[t.setup].count += 1; if (t.outcome === 'Winner') map[t.setup].wins += 1; if (t.outcome === 'Loser') map[t.setup].losses += 1; });
    return Object.values(map);
  }, [accountTrades]);

  const tickerStats = useMemo(() => {
    const map = {};
    accountTrades.forEach(t => { if (!map[t.ticker]) map[t.ticker] = { ticker: t.ticker, pnl: 0, count: 0 }; map[t.ticker].pnl += Number(t.netProfit); map[t.ticker].count += 1; });
    return Object.values(map).sort((a, b) => b.pnl - a.pnl);
  }, [accountTrades]);

  const sideStats = useMemo(() => {
    const buy = accountTrades.filter(t => t.side === 'Buy');
    const sell = accountTrades.filter(t => t.side === 'Sell');
    return [
      { name: 'Buy (Long)', count: buy.length, pnl: buy.reduce((s, t) => s + Number(t.netProfit), 0), winRate: buy.length > 0 ? (buy.filter(t => t.outcome === 'Winner').length / buy.length) * 100 : 0 },
      { name: 'Sell (Short)', count: sell.length, pnl: sell.reduce((s, t) => s + Number(t.netProfit), 0), winRate: sell.length > 0 ? (sell.filter(t => t.outcome === 'Winner').length / sell.length) * 100 : 0 },
    ];
  }, [accountTrades]);

  const distributionData = [
    { name: 'Gagnants', value: winners.length, color: '#10b981' },
    { name: 'Perdants', value: losers.length, color: '#ef4444' },
    { name: 'Break Even', value: accountTrades.filter(t => t.outcome === 'Break Even').length, color: '#94a3b8' },
  ].filter(d => d.value > 0);

  if (!account || account.type !== 'trading') return <div className="bg-white rounded-2xl p-6 border border-slate-200"><p className="text-sm text-slate-500">Sélectionnez un portefeuille.</p></div>;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-5 border border-slate-200">
        <p className="text-xs font-semibold text-slate-500 uppercase mb-3">Sélectionner un profil</p>
        <div className="flex flex-wrap gap-2">
          {tradingAccounts.map(a => (
            <button key={a.id} onClick={() => setSelectedAccount(a.id)} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${selectedAccount === a.id ? 'text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`} style={selectedAccount === a.id ? { background: a.color } : {}}>
              <span>{a.emoji}</span> {a.name}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-2xl p-6 text-white" style={{ background: `linear-gradient(135deg, ${account.color}, ${account.color}dd)` }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2"><span className="text-3xl">{account.emoji}</span><h2 className="text-2xl font-bold">{account.name}</h2></div>
            <p className="text-sm opacity-90">{accountTrades.length} trades clôturés</p>
          </div>
          <div className="text-right">
            <p className="text-xs opacity-75 mb-1">Solde actuel</p>
            <p className="text-3xl font-bold">{formatMoneyDecimal(Number(account.balance))}</p>
            {Number(account.goal) > 0 && <p className="text-xs opacity-90 mt-1">Objectif : {formatMoney(Number(account.goal))} ({Math.min((Number(account.balance) / Number(account.goal)) * 100, 100).toFixed(0)}%)</p>}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <KPICard label="P&L total" value={formatMoney(stats.totalPnL)} icon={stats.totalPnL >= 0 ? TrendingUp : TrendingDown} color={stats.totalPnL >= 0 ? 'emerald' : 'red'} />
        <KPICard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} icon={Target} color="blue" />
        <KPICard label="Profit Factor" value={stats.profitFactor === 999 ? '∞' : stats.profitFactor.toFixed(2)} icon={Activity} color="purple" />
        <KPICard label="Expectancy" value={formatMoney(expectancy)} icon={DollarSign} color={expectancy >= 0 ? 'emerald' : 'red'} />
      </div>
      <div className="grid grid-cols-4 gap-4">
        <MiniStat label="Gain moyen" value={formatMoney(avgWin)} positive />
        <MiniStat label="Perte moyenne" value={formatMoney(avgLoss)} />
        <MiniStat label="Meilleur trade" value={formatMoney(bestTrade)} positive />
        <MiniStat label="Pire trade" value={formatMoney(worstTrade)} />
      </div>
      <div className="bg-white rounded-2xl p-6 border border-slate-200">
        <h3 className="font-semibold mb-4">Évolution du P&L cumulé · {account.name}</h3>
        {evolution.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={evolution}>
              <defs><linearGradient id={`grad-${account.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={account.color} stopOpacity={0.4}/><stop offset="95%" stopColor={account.color} stopOpacity={0}/></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${(v/1000).toFixed(1)}k$`} />
              <Tooltip formatter={(v) => formatMoneyDecimal(v)} />
              <Area type="monotone" dataKey="value" stroke={account.color} strokeWidth={2.5} fill={`url(#grad-${account.id})`} />
            </AreaChart>
          </ResponsiveContainer>
        ) : <p className="text-sm text-slate-500 text-center py-12">Aucun trade clôturé</p>}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 border border-slate-200">
          <h3 className="font-semibold mb-4">Distribution des trades</h3>
          {distributionData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={distributionData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>{distributionData.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-slate-500 text-center py-12">Pas de données</p>}
        </div>
        <div className="bg-white rounded-2xl p-6 border border-slate-200">
          <h3 className="font-semibold mb-4">Long vs Short</h3>
          <div className="space-y-4">
            {sideStats.map(s => (
              <div key={s.name} className="p-4 bg-slate-50 rounded-xl">
                <div className="flex items-center justify-between mb-2"><span className={`font-medium text-sm ${s.name.includes('Buy') ? 'text-blue-700' : 'text-rose-700'}`}>{s.name}</span><span className="text-xs text-slate-500">{s.count} trades</span></div>
                <div className="flex items-center justify-between">
                  <div><p className="text-xs text-slate-500">Win Rate</p><p className="text-sm font-semibold">{s.winRate.toFixed(1)}%</p></div>
                  <div className="text-right"><p className="text-xs text-slate-500">P&L</p><p className={`text-sm font-semibold ${s.pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{s.pnl >= 0 ? '+' : ''}{formatMoney(s.pnl)}</p></div>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-1.5 mt-3"><div className={`h-1.5 rounded-full ${s.name.includes('Buy') ? 'bg-blue-500' : 'bg-rose-500'}`} style={{ width: `${s.winRate}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="bg-white rounded-2xl p-6 border border-slate-200">
        <h3 className="font-semibold mb-4">Performance par setup · {account.name}</h3>
        {setupStats.length > 0 ? (
          <div className="space-y-3">
            {setupStats.map(s => {
              const wr = s.count > 0 ? (s.wins / s.count) * 100 : 0;
              return (
                <div key={s.setup} className="p-4 bg-slate-50 rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2"><span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700 text-xs font-medium">{s.setup}</span><span className="text-xs text-slate-500">{s.count} trades · {s.wins}W / {s.losses}L</span></div>
                    <span className={`text-sm font-semibold ${s.pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{s.pnl >= 0 ? '+' : ''}{formatMoney(s.pnl)}</span>
                  </div>
                  <div className="flex items-center gap-2"><div className="flex-1 bg-slate-200 rounded-full h-2"><div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${wr}%` }} /></div><span className="text-xs text-slate-600 font-medium">{wr.toFixed(0)}% WR</span></div>
                </div>
              );
            })}
          </div>
        ) : <p className="text-sm text-slate-500 text-center py-8">Aucun setup</p>}
      </div>
      <div className="bg-white rounded-2xl p-6 border border-slate-200">
        <h3 className="font-semibold mb-4">Performance par actif · {account.name}</h3>
        {tickerStats.length > 0 ? (
          <div className="grid grid-cols-3 gap-3">
            {tickerStats.map(t => (
              <div key={t.ticker} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div><p className="font-semibold text-sm">{t.ticker}</p><p className="text-xs text-slate-500">{t.count} trade{t.count > 1 ? 's' : ''}</p></div>
                <p className={`font-semibold text-sm ${t.pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{t.pnl >= 0 ? '+' : ''}{formatMoney(t.pnl)}</p>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-slate-500 text-center py-8">Aucun actif</p>}
      </div>
    </div>
  );
}

function ProfileComparison({ accounts, getAccountStats, formatMoney, formatMoneyDecimal }) {
  const tradingAccounts = accounts.filter(a => a.type === 'trading');
  const data = tradingAccounts.map(a => { const s = getAccountStats(a.id); return { ...a, ...s, goalProgress: Number(a.goal) > 0 ? Math.min((Number(a.balance) / Number(a.goal)) * 100, 100) : 0 }; });
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100"><h3 className="font-semibold">Comparaison des profils</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-xs font-semibold text-slate-600 uppercase">
                <th className="text-left px-5 py-3">Profil</th><th className="text-right px-5 py-3">Solde</th><th className="text-right px-5 py-3">P&L</th><th className="text-right px-5 py-3">Trades</th><th className="text-right px-5 py-3">Win Rate</th><th className="text-right px-5 py-3">Profit Factor</th><th className="text-right px-5 py-3">Objectif</th>
              </tr>
            </thead>
            <tbody>
              {data.map(d => (
                <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-3"><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full" style={{ background: d.color }} /><span>{d.emoji}</span><span className="font-medium">{d.name}</span></div></td>
                  <td className={`px-5 py-3 text-right font-semibold ${Number(d.balance) >= 0 ? 'text-slate-900' : 'text-red-600'}`}>{formatMoneyDecimal(Number(d.balance))}</td>
                  <td className={`px-5 py-3 text-right font-semibold ${d.totalPnL >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{d.totalPnL >= 0 ? '+' : ''}{formatMoney(d.totalPnL)}</td>
                  <td className="px-5 py-3 text-right">{d.trades}</td>
                  <td className="px-5 py-3 text-right">{d.winRate.toFixed(1)}%</td>
                  <td className="px-5 py-3 text-right">{d.profitFactor === 999 ? '∞' : d.profitFactor.toFixed(2)}</td>
                  <td className="px-5 py-3 text-right">{Number(d.goal) > 0 ? (<div className="flex items-center gap-2 justify-end"><div className="w-16 bg-slate-200 rounded-full h-1.5"><div className="rounded-full h-1.5" style={{ width: `${d.goalProgress}%`, background: d.color }} /></div><span className="text-xs font-medium">{d.goalProgress.toFixed(0)}%</span></div>) : <span className="text-xs text-slate-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 border border-slate-200">
          <h3 className="font-semibold mb-4">Win Rate comparé</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} /><YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${v}%`} /><Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
              <Bar dataKey="winRate" radius={[8, 8, 0, 0]}>{data.map((e, i) => <Cell key={i} fill={e.color} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-2xl p-6 border border-slate-200">
          <h3 className="font-semibold mb-4">Profit Factor comparé</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.map(d => ({ ...d, profitFactor: d.profitFactor === 999 ? 10 : d.profitFactor }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} /><YAxis stroke="#94a3b8" fontSize={11} /><Tooltip formatter={(v) => v.toFixed(2)} />
              <Bar dataKey="profitFactor" radius={[8, 8, 0, 0]}>{data.map((e, i) => <Cell key={i} fill={e.color} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function KPICard({ label, value, icon: Icon, color }) {
  const colors = { emerald: 'bg-emerald-50 text-emerald-600', red: 'bg-red-50 text-red-600', blue: 'bg-blue-50 text-blue-600', purple: 'bg-purple-50 text-purple-600' };
  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200">
      <div className="flex items-center justify-between mb-3"><p className="text-xs font-medium text-slate-500 uppercase">{label}</p><div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[color]}`}><Icon className="w-4 h-4" /></div></div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

function MiniStat({ label, value, positive }) {
  return (<div className="bg-white rounded-xl p-4 border border-slate-200"><p className="text-xs text-slate-500 mb-1">{label}</p><p className={`text-lg font-bold ${positive ? 'text-emerald-600' : 'text-red-600'}`}>{value}</p></div>);
}

function TransferModal({ accounts, onClose, onSubmit, formatMoneyDecimal }) {
  const [form, setForm] = useState({ from: accounts[0]?.id, to: accounts[1]?.id, amount: '', date: new Date().toISOString().split('T')[0], note: '' });
  const srcBal = Number(accounts.find(a => a.id === form.from)?.balance) || 0;
  const valid = form.from !== form.to && parseFloat(form.amount) > 0;
  return (
    <Modal title="Nouveau virement" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Compte source"><select value={form.from} onChange={(e) => setForm({...form, from: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">{accounts.map(a => <option key={a.id} value={a.id}>{a.emoji} {a.name} — {formatMoneyDecimal(Number(a.balance))}</option>)}</select><p className="text-xs text-slate-500 mt-1">Solde : {formatMoneyDecimal(srcBal)}</p></Field>
        <Field label="Compte destination"><select value={form.to} onChange={(e) => setForm({...form, to: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">{accounts.filter(a => a.id !== form.from).map(a => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}</select></Field>
        <Field label="Montant ($USD)"><input type="number" value={form.amount} onChange={(e) => setForm({...form, amount: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></Field>
        <Field label="Date"><input type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></Field>
        <Field label="Note (optionnel)"><input type="text" value={form.note} onChange={(e) => setForm({...form, note: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></Field>
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium">Annuler</button>
          <button onClick={() => valid && onSubmit(form)} disabled={!valid} className="flex-1 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"><Check className="w-4 h-4" />Valider</button>
        </div>
      </div>
    </Modal>
  );
}

function TradeModal({ accounts, onClose, onSubmit }) {
  const ta = accounts.filter(a => a.type === 'trading');
  const [form, setForm] = useState({ ticker: '', account: ta[0]?.id, type: 'Crypto', side: 'Buy', openDate: new Date().toISOString().split('T')[0], closeDate: new Date().toISOString().split('T')[0], entry: '', exit: '', quantity: '', netProfit: '', mise: '', levier: '', position: '', setup: 'Breakout', outcome: 'Winner', status: 'Closed', fees: '' });
  return (
    <Modal title="Nouveau trade" onClose={onClose} large>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Ticker"><input type="text" value={form.ticker} onChange={(e) => setForm({...form, ticker: e.target.value.toUpperCase()})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></Field>
        <Field label="Compte"><select value={form.account} onChange={(e) => setForm({...form, account: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">{ta.map(a => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}</select></Field>
        <Field label="Type"><select value={form.type} onChange={(e) => setForm({...form, type: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"><option>Crypto</option><option>Stocks</option><option>Forex</option><option>Futures</option></select></Field>
        <Field label="Side"><select value={form.side} onChange={(e) => setForm({...form, side: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"><option>Buy</option><option>Sell</option></select></Field>
        <Field label="Open date"><input type="date" value={form.openDate} onChange={(e) => setForm({...form, openDate: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></Field>
        <Field label="Close date"><input type="date" value={form.closeDate} onChange={(e) => setForm({...form, closeDate: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></Field>
        <Field label="Entry"><input type="number" step="any" value={form.entry} onChange={(e) => setForm({...form, entry: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></Field>
        <Field label="Exit"><input type="number" step="any" value={form.exit} onChange={(e) => setForm({...form, exit: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></Field>
        <Field label="Quantité"><input type="number" step="any" value={form.quantity} onChange={(e) => setForm({...form, quantity: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></Field>
        <Field label="Mise ($)"><input type="number" step="any" value={form.mise} onChange={(e) => setForm({...form, mise: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></Field>
        <Field label="Levier"><input type="number" value={form.levier} onChange={(e) => setForm({...form, levier: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></Field>
        <Field label="Position ($)"><input type="number" step="any" value={form.position} onChange={(e) => setForm({...form, position: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></Field>
        <Field label="Net Profit ($)"><input type="number" step="any" value={form.netProfit} onChange={(e) => setForm({...form, netProfit: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></Field>
        <Field label="Frais ($)"><input type="number" step="any" value={form.fees} onChange={(e) => setForm({...form, fees: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></Field>
        <Field label="Setup"><select value={form.setup} onChange={(e) => setForm({...form, setup: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"><option>Breakout</option><option>ABCD</option><option>Reversal</option><option>Trend Following</option><option>Range</option></select></Field>
        <Field label="Résultat"><select value={form.outcome} onChange={(e) => setForm({...form, outcome: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"><option>Winner</option><option>Loser</option><option>Break Even</option></select></Field>
      </div>
      <div className="flex gap-2 pt-4 mt-4 border-t border-slate-100">
        <button onClick={onClose} className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium">Annuler</button>
        <button onClick={() => onSubmit(form)} disabled={!form.ticker} className="flex-1 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"><Check className="w-4 h-4" />Enregistrer</button>
      </div>
    </Modal>
  );
}

function AccountModal({ account, onClose, onSubmit }) {
  const [form, setForm] = useState({ name: account?.name || '', emoji: account?.emoji || '💼', balance: account?.balance ?? '', goal: account?.goal ?? '', color: account?.color || '#3b82f6' });
  const colors = ['#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#f59e0b', '#06b6d4', '#ef4444', '#84cc16'];
  const emojis = ['💼', '🧠', '👁️', '💎', '🚀', '⚡', '🎯', '🔥', '💰', '📈', '🏦', '🎲'];
  return (
    <Modal title={account ? 'Modifier le compte' : 'Nouveau compte'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Nom"><input type="text" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></Field>
        <Field label="Emoji"><div className="flex flex-wrap gap-2">{emojis.map(e => <button key={e} onClick={() => setForm({...form, emoji: e})} className={`w-9 h-9 rounded-lg text-lg ${form.emoji === e ? 'bg-slate-900' : 'bg-slate-100 hover:bg-slate-200'}`}>{e}</button>)}</div></Field>
        <Field label="Couleur"><div className="flex gap-2">{colors.map(c => <button key={c} onClick={() => setForm({...form, color: c})} className={`w-8 h-8 rounded-lg ${form.color === c ? 'ring-2 ring-offset-2 ring-slate-900' : ''}`} style={{ background: c }} />)}</div></Field>
        <Field label="Solde ($)"><input type="number" step="any" value={form.balance} onChange={(e) => setForm({...form, balance: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></Field>
        <Field label="Objectif ($)"><input type="number" step="any" value={form.goal} onChange={(e) => setForm({...form, goal: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></Field>
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium">Annuler</button>
          <button onClick={() => form.name && onSubmit(form)} disabled={!form.name} className="flex-1 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"><Check className="w-4 h-4" />Enregistrer</button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose, large = false }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl ${large ? 'max-w-2xl' : 'max-w-md'} w-full max-h-[90vh] overflow-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100"><h3 className="font-semibold">{title}</h3><button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4" /></button></div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (<div><label className="block text-xs font-medium text-slate-600 mb-1.5">{label}</label>{children}</div>);
}
