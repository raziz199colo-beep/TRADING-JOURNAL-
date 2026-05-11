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
    const
