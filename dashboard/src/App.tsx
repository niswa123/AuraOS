import { useState, useEffect, useRef } from 'react';
import { 
  Cpu, 
  Terminal, 
  Play, 
  Pause, 
  Layers, 
  Clock, 
  Database,
  Activity
} from 'lucide-react';

interface Agent {
  id: string;
  name: string;
  runtime: 'python' | 'node';
  status: 'running' | 'hibernating' | 'sleeping' | 'completed' | 'failed';
  lastActive: string;
}

interface LogEntry {
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'system';
  message: string;
}

export default function App() {
  // --- States ---
  const [agents, setAgents] = useState<Agent[]>([
    { id: 'agent-1', name: 'Observability Sentry', runtime: 'python', status: 'sleeping', lastActive: '2 min ago' },
    { id: 'agent-2', name: 'Database Sync Scheduler', runtime: 'node', status: 'running', lastActive: 'Active now' },
    { id: 'agent-3', name: 'Task Billing Worker', runtime: 'python', status: 'hibernating', lastActive: '10 min ago' },
  ]);

  const [selectedAgentId, setSelectedAgentId] = useState<string>('agent-2');
  
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({
    'agent-1': [
      { timestamp: '19:00:15', stream: 'system', message: 'Waking up agent Observability Sentry via CRON trigger...' },
      { timestamp: '19:00:16', stream: 'stdout', message: 'Initializing system telemetry metrics check...' },
      { timestamp: '19:00:18', stream: 'stdout', message: 'All target endpoints healthy. Status code: 200' },
      { timestamp: '19:00:19', stream: 'system', message: 'State serialized. Hibernating container.' }
    ],
    'agent-2': [
      { timestamp: '19:05:01', stream: 'system', message: 'AuraOS Sandbox spawned successfully.' },
      { timestamp: '19:05:02', stream: 'stdout', message: 'Fetching connection counts from pool...' },
      { timestamp: '19:05:03', stream: 'stdout', message: 'Active pools: 12. Idle pools: 8.' },
      { timestamp: '19:05:04', stream: 'stderr', message: '[Warning] Database pool limit approached: 85% utilization.' }
    ],
    'agent-3': [
      { timestamp: '18:50:22', stream: 'system', message: 'Hibernate instruction executed.' },
      { timestamp: '18:50:23', stream: 'system', message: 'Tearing down container instances. Context serialized.' }
    ]
  });

  const [variables, setVariables] = useState<Record<string, Record<string, any>>>({
    'agent-1': {
      telemetry_target: 'http://localhost:5433',
      metrics_scraped: 42,
      last_check_status: 'healthy'
    },
    'agent-2': {
      connection_limit: 100,
      active_connections: 85,
      pool_state: 'warning',
      db_port: 5433
    },
    'agent-3': {
      billing_cycles_completed: 18,
      pending_transactions: 0,
      awaiting_callback: true
    }
  });

  const [timelines, setTimelines] = useState<Record<string, 'Trigger' | 'Active' | 'Hibernate' | 'Sleep'>>({
    'agent-1': 'Sleep',
    'agent-2': 'Active',
    'agent-3': 'Hibernate'
  });

  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // --- WebSockets Integration ---
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8085');

    ws.onopen = () => {
      setWsConnected(true);
      console.log('Connected to AuraOS Live Stream.');
    };

    ws.onclose = () => {
      setWsConnected(false);
      console.log('Disconnected from AuraOS Live Stream.');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const { type, agentId, timestamp, payload } = data;

        if (type === 'status_change') {
          setAgents(prev => {
            const exists = prev.some(a => a.id === agentId);
            if (exists) {
              return prev.map(a => a.id === agentId ? { ...a, status: payload.status, lastActive: 'Active now' } : a);
            } else {
              return [
                ...prev,
                {
                  id: agentId,
                  name: (payload.name as string) || 'Dynamic Container',
                  runtime: (payload.runtime as 'python' | 'node') || 'python',
                  status: payload.status as Agent['status'],
                  lastActive: 'Active now'
                }
              ];
            }
          });
          setSelectedAgentId(agentId);
        }

        if (type === 'log') {
          const timeString = new Date(timestamp).toLocaleTimeString();
          setLogs(prev => ({
            ...prev,
            [agentId]: [
              ...(prev[agentId] || []),
              { timestamp: timeString, stream: payload.stream, message: payload.message }
            ]
          }));
        }

        if (type === 'state_change') {
          setVariables(prev => ({
            ...prev,
            [agentId]: payload.variables
          }));
        }

        if (type === 'timeline_transition') {
          setTimelines(prev => ({
            ...prev,
            [agentId]: payload.stage
          }));
        }
      } catch (err) {
        console.error('Error parsing live WS event:', err);
      }
    };

    return () => ws.close();
  }, []);

  // --- Auto-scroll logs ---
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, selectedAgentId]);

  const selectedAgent = agents.find(a => a.id === selectedAgentId) || agents[0];
  const activeLogs = logs[selectedAgent.id] || [];
  const activeVariables = variables[selectedAgent.id] || {};
  const activeTimeline = timelines[selectedAgent.id] || 'Sleep';

  // --- Manual triggers simulation for visual richness ---
  const triggerSimulation = (action: 'wakeup' | 'hibernate') => {
    const time = new Date().toLocaleTimeString();
    if (action === 'wakeup') {
      setAgents(prev => prev.map(a => a.id === selectedAgent.id ? { ...a, status: 'running' } : a));
      setTimelines(prev => ({ ...prev, [selectedAgent.id]: 'Active' }));
      setLogs(prev => ({
        ...prev,
        [selectedAgent.id]: [
          ...(prev[selectedAgent.id] || []),
          { timestamp: time, stream: 'system', message: 'Manual wakeup requested. Spawning container sandbox...' }
        ]
      }));
    } else {
      setAgents(prev => prev.map(a => a.id === selectedAgent.id ? { ...a, status: 'sleeping' } : a));
      setTimelines(prev => ({ ...prev, [selectedAgent.id]: 'Sleep' }));
      setLogs(prev => ({
        ...prev,
        [selectedAgent.id]: [
          ...(prev[selectedAgent.id] || []),
          { timestamp: time, stream: 'system', message: 'Manual hibernate command sent. Container destroyed.' }
        ]
      }));
    }
  };

  return (
    <div className="dashboard-wrapper">
      {/* Background Ambience */}
      <div className="ambient-glow" style={{ top: '-10%', left: '10%' }}></div>
      <div className="ambient-glow" style={{ bottom: '-15%', right: '10%', background: 'radial-gradient(circle, rgba(45, 212, 191, 0.04) 0%, transparent 70%)' }}></div>

      {/* Header */}
      <header className="panel header-container">
        <div className="header-logo-group">
          <div className="header-icon">
            <Layers style={{ width: '24px', height: '24px' }} />
          </div>
          <div className="header-title-text">
            <h1>AuraOS Control Center</h1>
            <p>Agentic runtime environment & sandbox supervisor</p>
          </div>
        </div>

        {/* Live status indicators */}
        <div className="status-badge-group">
          <div className="badge">
            <Activity style={{ width: '16px', height: '16px', color: '#10b981' }} />
            <span>Database: Connected</span>
          </div>

          <div className="badge">
            <span 
              className={`status-dot ${wsConnected ? 'active' : 'sleeping'}`} 
              style={{ position: 'relative', border: 'none', width: '8px', height: '8px' }}
            ></span>
            <span>Live Stream: {wsConnected ? 'Connected' : 'Offline'}</span>
          </div>
        </div>
      </header>

      {/* Main Grid Section */}
      <div className="main-grid">
        
        {/* Left Column: Agent Selection Grid */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="agent-list-header">
            <h2 className="agent-list-title">
              <Cpu style={{ width: '16px', height: '16px', color: '#818cf8' }} />
              Cognitive Containers
            </h2>
            <span className="agent-list-count">
              {agents.length} Total
            </span>
          </div>

          <div className="agent-cards-container custom-scrollbar">
            {agents.map((agent) => {
              const isRunning = agent.status === 'running';
              const isSelected = agent.id === selectedAgentId;
              
              return (
                <div 
                  key={agent.id}
                  onClick={() => setSelectedAgentId(agent.id)}
                  className={`agent-card ${isSelected ? 'selected' : ''}`}
                >
                  <div className="agent-card-header">
                    <div className="agent-card-identity">
                      {/* Neon indicator ring for active container */}
                      <div className="agent-avatar-wrapper">
                        <div className={`agent-avatar ${isRunning ? 'active' : ''} ${isRunning ? 'active-glow' : ''}`}>
                          {agent.runtime === 'python' ? 'PY' : 'JS'}
                        </div>
                        <span className={`status-dot ${
                          isRunning 
                            ? 'active' 
                            : agent.status === 'hibernating' 
                            ? 'hibernating' 
                            : 'sleeping'
                        }`}></span>
                      </div>
                      <div className="agent-card-info">
                        <h3>{agent.name}</h3>
                        <p>{agent.id}</p>
                      </div>
                    </div>
                    <span className="agent-time-text">{agent.lastActive}</span>
                  </div>

                  <div className="agent-card-footer">
                    <span style={{ color: 'var(--color-text-muted)' }}>Status:</span>
                    <span className={`status-badge ${
                      isRunning 
                        ? 'active' 
                        : agent.status === 'hibernating'
                        ? 'hibernating'
                        : 'sleeping'
                    }`}>{agent.status}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick Actions Panel */}
          <div className="manual-override-section">
            <h3>Manual Override</h3>
            <div className="override-btn-group">
              <button 
                onClick={() => triggerSimulation('wakeup')}
                disabled={selectedAgent.status === 'running'}
                className="btn btn-primary"
              >
                <Play style={{ width: '14px', height: '14px' }} />
                Wake up
              </button>
              <button 
                onClick={() => triggerSimulation('hibernate')}
                disabled={selectedAgent.status !== 'running'}
                className="btn btn-secondary"
              >
                <Pause style={{ width: '14px', height: '14px' }} />
                Hibernate
              </button>
            </div>
          </div>
        </div>

        {/* Right Content Area */}
        <div className="right-content">

          {/* Top Half: Log Stream Console */}
          <div className="panel console-section">
            <div className="section-header">
              <h2 className="section-title">
                <Terminal style={{ width: '16px', height: '16px', color: '#818cf8' }} />
                Console Log Stream
              </h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                Watching: {selectedAgent.name}
              </span>
            </div>

            <div className="console-container custom-scrollbar" ref={logContainerRef}>
              {activeLogs.length === 0 ? (
                <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No output logs recorded for this agent.</div>
              ) : (
                activeLogs.map((log, index) => {
                  let msgClass = 'log-msg-stdout';
                  if (log.stream === 'stderr' || log.message.toLowerCase().includes('error')) {
                    msgClass = 'log-msg-stderr';
                  } else if (log.stream === 'system') {
                    msgClass = 'log-msg-system';
                  }

                  return (
                    <div key={index} className="log-line">
                      <span className="log-time">[{log.timestamp}]</span>
                      <span className="log-stream">[{log.stream}]</span>
                      <span className={msgClass}>{log.message}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Bottom Half: JSON inspector and Interactive Timeline */}
          <div className="bottom-split-grid">
            
            {/* JSON State Inspector */}
            <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h2 className="section-title" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '12px', margin: '0' }}>
                <Database style={{ width: '16px', height: '16px', color: '#818cf8' }} />
                Variable Inspector
              </h2>
              <pre className="inspector-pre custom-scrollbar">
                {JSON.stringify(activeVariables, null, 2)}
              </pre>
            </div>

            {/* Interactive Timeline */}
            <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h2 className="section-title" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '12px', margin: '0' }}>
                <Clock style={{ width: '16px', height: '16px', color: '#818cf8' }} />
                Chronos State Transitions
              </h2>
              
              <div style={{ flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '16px' }}>
                {/* Horizontal progress visualization */}
                <div className="timeline-flex">
                  <div className="timeline-line"></div>
                  
                  {/* Stages */}
                  {['Trigger', 'Active', 'Hibernate', 'Sleep'].map((stage, idx) => {
                    const stages = ['Trigger', 'Active', 'Hibernate', 'Sleep'];
                    const currentIdx = stages.indexOf(activeTimeline);
                    const isCompleted = idx <= currentIdx;
                    const isCurrent = activeTimeline === stage;

                    return (
                      <div key={stage} className={`timeline-step ${isCurrent ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}>
                        <div className="timeline-dot">
                          {idx + 1}
                        </div>
                        <span className="timeline-label">
                          {stage}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="timeline-info-text">
                  {activeTimeline === 'Sleep' && 'Agent context is serialized on disk. 0% CPU consumption.'}
                  {activeTimeline === 'Active' && 'Agent running dynamically inside isolated container sandbox.'}
                  {activeTimeline === 'Hibernate' && 'Graceful teardown initiated. Context variables stored.'}
                  {activeTimeline === 'Trigger' && 'External cron scheduler or webhook hit detected.'}
                </div>
              </div>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
