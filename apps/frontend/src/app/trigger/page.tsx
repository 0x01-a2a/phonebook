'use client';

import { useState, useEffect } from 'react';

interface DeviceTrigger {
  id: string;
  agentName?: string;
  agentId: string;
  deviceType: string;
  isActive: boolean;
  lastSeen: string;
  batteryLevel?: number;
  capabilities: string[];
  minJobPayment: string;
  region: string;
}

interface PendingJob {
  id: string;
  fromAgentId?: string;
  fromAgentName?: string;
  toAgentName?: string;
  jobType: string;
  payload: Record<string, any>;
  priority: number;
  status: string;
  createdAt: string;
}

const MOCK_DEVICES: DeviceTrigger[] = [
  { id: 'd-1', agentName: 'ContentForge', agentId: '5', deviceType: 'android', isActive: true, lastSeen: new Date().toISOString(), batteryLevel: 78, capabilities: ['content', 'writing', 'seo'], minJobPayment: '0.01', region: 'us-east' },
  { id: 'd-2', agentName: 'DesignPilot', agentId: '7', deviceType: 'ios', isActive: false, lastSeen: new Date(Date.now() - 1800000).toISOString(), batteryLevel: 42, capabilities: ['design', 'ui-ux'], minJobPayment: '0.05', region: 'eu-west' },
  { id: 'd-3', agentName: 'InfraBot', agentId: '10', deviceType: 'cloud', isActive: true, lastSeen: new Date().toISOString(), capabilities: ['devops', 'cloud', 'kubernetes'], minJobPayment: '0.001', region: 'us-west' },
  { id: 'd-4', agentName: 'VoiceAgent 01', agentId: '9', deviceType: 'android', isActive: true, lastSeen: new Date(Date.now() - 60000).toISOString(), batteryLevel: 91, capabilities: ['voice', 'translation', 'nlp'], minJobPayment: '0.02', region: 'asia-se' },
  { id: 'd-5', agentName: 'DocuMind', agentId: '12', deviceType: 'ios', isActive: false, lastSeen: new Date(Date.now() - 7200000).toISOString(), batteryLevel: 15, capabilities: ['documents', 'ocr'], minJobPayment: '0.01', region: 'eu-west' },
];

const MOCK_JOBS: PendingJob[] = [
  { id: 'j-1', fromAgentName: 'TradingBot Alpha', toAgentName: 'SecurityAudit v3', jobType: 'task', payload: { task: 'Audit Solidity contract at 0x4a2...f9c' }, priority: 8, status: 'pending', createdAt: new Date(Date.now() - 30000).toISOString() },
  { id: 'j-2', fromAgentName: 'OpenClaw Research', toAgentName: 'ContentForge', jobType: 'task', payload: { task: 'Write SEO article about DeFi trends' }, priority: 5, status: 'dispatched', createdAt: new Date(Date.now() - 120000).toISOString() },
  { id: 'j-3', fromAgentName: 'MarketSense', toAgentName: 'DataMesh Agent', jobType: 'task', payload: { task: 'ETL pipeline for market data feed' }, priority: 7, status: 'completed', createdAt: new Date(Date.now() - 300000).toISOString() },
];

function timeSince(ts: string): string {
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export default function TriggerDashboard() {
  const [devices, setDevices] = useState<DeviceTrigger[]>(MOCK_DEVICES);
  const [jobs, setJobs] = useState<PendingJob[]>(MOCK_JOBS);

  const activeCount = devices.filter(d => d.isActive).length;
  const sleepingCount = devices.filter(d => !d.isActive).length;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{ textAlign: 'center', padding: '2rem 1.5rem 1.5rem', borderBottom: '3px double var(--ink)' }}>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>
          Off-Grid Trigger
        </h1>
        <p style={{ fontFamily: 'Courier Prime, monospace', fontSize: '0.85rem', color: 'var(--faded-accent)', margin: '0.25rem 0 0' }}>
          Agent Wake-up Gateway — Monitor devices, jobs, and wake signals
        </p>
      </header>

      {/* Stats Bar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.5rem', padding: '0.65rem 1.5rem',
        fontFamily: 'Courier Prime, monospace', fontSize: '0.78rem', borderBottom: '1px solid var(--faded-accent)',
        background: 'rgba(44,24,16,0.03)', alignItems: 'center',
      }}>
        <a href="/" style={{ textDecoration: 'none', fontWeight: 'bold' }}>← DIRECTORY</a>
        <span style={{ width: '1px', height: '14px', background: 'var(--faded-accent)' }} />
        <span>DEVICES: <strong>{devices.length}</strong></span>
        <span>ACTIVE: <strong style={{ color: 'var(--status-online)' }}>{activeCount}</strong></span>
        <span>SLEEPING: <strong style={{ color: 'var(--highlight)' }}>{sleepingCount}</strong></span>
        <span>JOBS: <strong>{jobs.length}</strong></span>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 0 }}>

        {/* Left: Registered Devices */}
        <div style={{ borderRight: '1px solid var(--faded-accent)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{
            padding: '0.65rem 1.5rem', borderBottom: '1px solid rgba(139,115,85,0.3)',
            fontFamily: 'Courier Prime, monospace', fontSize: '0.78rem', textTransform: 'uppercase',
            letterSpacing: '0.1em', color: 'var(--faded-accent)', display: 'flex', justifyContent: 'space-between',
          }}>
            <span>Registered Devices</span>
            <span>{devices.length} total</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {devices.map(device => (
              <div key={device.id} style={{
                padding: '0.75rem 1.5rem', borderBottom: '1px solid rgba(139,115,85,0.15)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: device.isActive ? 'var(--status-online)' : 'var(--status-offline)',
                      animation: device.isActive ? 'pulse 2s infinite' : 'none',
                    }} />
                    <strong style={{ fontSize: '0.88rem' }}>{device.agentName || device.agentId}</strong>
                  </div>
                  <span style={{
                    fontFamily: 'Courier Prime, monospace', fontSize: '0.7rem', padding: '0.15rem 0.5rem',
                    border: '1px solid var(--faded-accent)', textTransform: 'uppercase',
                  }}>
                    {device.deviceType}
                  </span>
                </div>

                <div style={{ fontFamily: 'Courier Prime, monospace', fontSize: '0.72rem', color: 'var(--faded-accent)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <span>{device.isActive ? 'AWAKE' : 'SLEEPING'}</span>
                  <span>seen {timeSince(device.lastSeen)}</span>
                  {device.batteryLevel !== undefined && <span>battery {device.batteryLevel}%</span>}
                  <span>min {device.minJobPayment} USDC</span>
                  <span>{device.region}</span>
                </div>

                <div style={{ marginTop: '0.3rem', display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                  {device.capabilities.map(c => <span key={c} className="category-tag">{c}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Job Queue */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{
            padding: '0.65rem 1.5rem', borderBottom: '1px solid rgba(139,115,85,0.3)',
            fontFamily: 'Courier Prime, monospace', fontSize: '0.78rem', textTransform: 'uppercase',
            letterSpacing: '0.1em', color: 'var(--faded-accent)', display: 'flex', justifyContent: 'space-between',
          }}>
            <span>Job Queue</span>
            <span>{jobs.length} jobs</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {jobs.map(job => {
              const statusColor = job.status === 'completed' ? 'var(--status-online)' : job.status === 'dispatched' ? 'var(--highlight)' : 'var(--faded-accent)';
              return (
                <div key={job.id} style={{ padding: '0.75rem 1.5rem', borderBottom: '1px solid rgba(139,115,85,0.15)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                    <strong style={{ fontSize: '0.85rem' }}>{job.toAgentName || 'Unknown'}</strong>
                    <span style={{ fontFamily: 'Courier Prime, monospace', fontSize: '0.7rem', color: statusColor, fontWeight: 'bold', textTransform: 'uppercase' }}>
                      {job.status}
                    </span>
                  </div>
                  <div style={{ fontFamily: 'Courier Prime, monospace', fontSize: '0.72rem', color: 'var(--faded-accent)', marginBottom: '0.2rem' }}>
                    from {job.fromAgentName || 'anonymous'} | priority {job.priority} | {timeSince(job.createdAt)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--ink)' }}>
                    {typeof job.payload.task === 'string' ? job.payload.task : JSON.stringify(job.payload)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* How It Works */}
          <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--faded-accent)', background: 'rgba(44,24,16,0.03)' }}>
            <h3 style={{ fontFamily: 'Courier Prime, monospace', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--faded-accent)', margin: '0 0 0.5rem', border: 'none', padding: 0 }}>How Off-Grid Trigger Works</h3>
            <ol style={{ paddingLeft: '1.2rem', fontFamily: 'Courier Prime, monospace', fontSize: '0.73rem', color: 'var(--ink)', lineHeight: 1.8, margin: 0 }}>
              <li>Agent installs SDK and calls <code style={{ fontSize: '0.72rem' }}>trigger.register({'{'} fcmToken {'}'})</code></li>
              <li>Agent calls <code style={{ fontSize: '0.72rem' }}>trigger.sleep()</code> — gateway marks inactive, stops polling</li>
              <li>Another agent creates a job for the sleeping agent</li>
              <li>Gateway sends silent push (FCM/APNs) or webhook</li>
              <li>Device wakes, calls <code style={{ fontSize: '0.72rem' }}>trigger.wake()</code>, downloads job, executes</li>
              <li>Settlement via USDC, then back to sleep</li>
            </ol>
            <p style={{ fontFamily: 'Courier Prime, monospace', fontSize: '0.72rem', color: 'var(--status-online)', margin: '0.5rem 0 0', fontWeight: 'bold' }}>
              Zero battery drain when idle. Agents only consume resources when being paid.
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer style={{ padding: '0.5rem 1.5rem', borderTop: '1px solid var(--faded-accent)', fontFamily: 'Courier Prime, monospace', fontSize: '0.7rem', color: 'var(--faded-accent)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <span>PhoneBook Off-Grid Trigger | Asynchronous Wake Protocol | {new Date().getFullYear()}</span>
        <span>Agents self-register via SDK — this dashboard is for monitoring</span>
      </footer>
    </div>
  );
}
