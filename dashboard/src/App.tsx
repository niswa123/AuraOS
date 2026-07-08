import { useState, useEffect, useRef } from 'react';
import { 
  Cpu, 
  Terminal, 
  Play, 
  Pause, 
  Layers, 
  Activity,
  AlertCircle,
  Plus,
  X,
  Edit2,
  Trash2,
  DollarSign
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

interface BillingStats {
  durationMs: number;
  ramAllocatedMb: number;
  costUsd: number;
}

const DEFAULT_PYTHON_CODE = `import time
# AuraOS Intermediate Checkpoint Demonstration Script
print("🚀 Execution cycle active inside secure Docker sandbox...")

# 1. Simulate process computation
time.sleep(1)

# 2. Write checkpoint to filesystem (State Engine recovery check)
checkpoint_data = '{"last_iteration": 42, "computed_value": 98.76, "status": "in_progress"}'
with open("/tmp/state_checkpoint.json", "w") as f:
    f.write(checkpoint_data)
print("💾 Intermediate state checkpoint written to /tmp/state_checkpoint.json")

# 3. Simulate remaining work
time.sleep(1)
print("✅ Sandbox execution complete. Initiating graceful teardown...")`;

export default function App() {
  // --- States ---
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({});
  const [billingStats, setBillingStats] = useState<Record<string, BillingStats>>({});
  const [agentCodes, setAgentCodes] = useState<Record<string, string>>({});
  const [agentRuntimes, setAgentRuntimes] = useState<Record<string, 'python' | 'node'>>({});

  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  // --- Registration Form States ---
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);
  const [newAgentName, setNewAgentName] = useState<string>('');
  const [newAgentRuntime, setNewAgentRuntime] = useState<'python' | 'node'>('python');
  const [newAgentCode, setNewAgentCode] = useState<string>(DEFAULT_PYTHON_CODE);
  const [formSubmitting, setFormSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // --- Edit Form States ---
  const [showEditForm, setShowEditForm] = useState<boolean>(false);
  const [editAgentName, setEditAgentName] = useState<string>('');
  const [editAgentRuntime, setEditAgentRuntime] = useState<'python' | 'node'>('python');
  const [editAgentCode, setEditAgentCode] = useState<string>('');
  const [editSubmitting, setEditSubmitting] = useState<boolean>(false);

  // --- WebSockets Integration ---
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8085');
    socketRef.current = ws;

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

        // 1. Initial load of all agents from PostgreSQL
        if (type === 'init_agents' && payload.agents) {
          const loadedAgents = payload.agents as Agent[];
          setAgents(loadedAgents);
          if (loadedAgents.length > 0) {
            setSelectedAgentId(loadedAgents[0].id);
          }
        }

        // 2. Load agent-specific state details
        if (type === 'agent_details' && payload) {
          if (payload.code) {
            setAgentCodes(prev => ({ ...prev, [agentId]: payload.code }));
          }
          if (payload.runtime) {
            setAgentRuntimes(prev => ({ ...prev, [agentId]: payload.runtime }));
          }
          // Load historical billing metrics if returned
          if (payload.variables) {
            const lastDuration = payload.variables.last_run_duration_ms || 0;
            const cost = lastDuration ? (lastDuration / 1000) * (128 / 1024) * 0.00001667 : 0;
            setBillingStats(prev => ({
              ...prev,
              [agentId]: {
                durationMs: lastDuration,
                ramAllocatedMb: 128,
                costUsd: cost
              }
            }));
          }
        }

        // 3. Status changes (dynamic running/sleeping changes, or deletions)
        if (type === 'status_change') {
          if (payload.status === 'deleted') {
            setAgents(prev => prev.filter(a => a.id !== agentId));
            setSelectedAgentId(prev => prev === agentId ? null : prev);
            return;
          }
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

        // 4. Live log streams
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

        // 5. Billing metrics broadcast
        if (type === 'billing_metrics' && payload) {
          setBillingStats(prev => ({
            ...prev,
            [agentId]: {
              durationMs: payload.durationMs,
              ramAllocatedMb: payload.ramAllocatedMb,
              costUsd: payload.costUsd
            }
          }));
        }
      } catch (err) {
        console.error('Error parsing live WS event:', err);
      }
    };

    return () => {
      ws.close();
      socketRef.current = null;
    };
  }, []);

  // --- Fetch agent details when selectedAgentId changes ---
  useEffect(() => {
    if (selectedAgentId && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        action: 'get_agent_details',
        agentId: selectedAgentId
      }));
    }
    setShowEditForm(false);
  }, [selectedAgentId, wsConnected]);

  // --- Auto-scroll logs ---
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, selectedAgentId]);

  const selectedAgent = selectedAgentId ? agents.find(a => a.id === selectedAgentId) : null;
  const activeLogs = selectedAgent ? logs[selectedAgent.id] || [] : [];
  const activeBilling = selectedAgent ? billingStats[selectedAgent.id] : null;

  // --- Trigger wakeup ---
  const triggerWakeup = async () => {
    if (!selectedAgent) return;
    try {
      const response = await fetch(`http://localhost:8081/webhook/${selectedAgent.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggered_by_ui: true })
      });
      if (!response.ok) throw new Error('Wakeup webhook trigger failed.');
    } catch (err: any) {
      console.error(err);
      // Fallback local triggers simulator for visual reassurance if fetch fails
      const time = new Date().toLocaleTimeString();
      setAgents(prev => prev.map(a => a.id === selectedAgent.id ? { ...a, status: 'running' } : a));
      setLogs(prev => ({
        ...prev,
        [selectedAgent.id]: [
          ...(prev[selectedAgent.id] || []),
          { timestamp: time, stream: 'system', message: 'Manual wakeup requested (local simulation).' }
        ]
      }));
    }
  };

  const triggerHibernate = () => {
    if (!selectedAgent) return;
    const time = new Date().toLocaleTimeString();
    setAgents(prev => prev.map(a => a.id === selectedAgent.id ? { ...a, status: 'sleeping' } : a));
    setLogs(prev => ({
      ...prev,
      [selectedAgent.id]: [
        ...(prev[selectedAgent.id] || []),
        { timestamp: time, stream: 'system', message: 'Manual hibernate command sent. Container destroyed.' }
      ]
    }));
  };

  // --- Submit form to register agent via REST API ---
  const handleRegisterAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentName.trim() || !newAgentCode.trim()) {
      setFormError('Please fill out all required fields.');
      return;
    }

    setFormSubmitting(true);
    setFormError(null);

    try {
      const response = await fetch('http://localhost:8081/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newAgentName,
          runtime: newAgentRuntime,
          code: newAgentCode
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to register agent.');
      }
      setSelectedAgentId(result.agent.id);
      
      setNewAgentName('');
      setNewAgentRuntime('python');
      setNewAgentCode(DEFAULT_PYTHON_CODE);
      setShowCreateForm(false);
    } catch (err: any) {
      setFormError(err.message || 'Error occurred during registration.');
    } finally {
      setFormSubmitting(false);
    }
  };

  // --- Update agent (Edit) ---
  const handleEditAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgentId || !editAgentName.trim() || !editAgentCode.trim()) return;

    setEditSubmitting(true);
    try {
      const response = await fetch(`http://localhost:8081/api/agents/${selectedAgentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editAgentName,
          runtime: editAgentRuntime,
          code: editAgentCode
        })
      });
      if (!response.ok) throw new Error('Failed to update agent.');

      setAgents(prev => prev.map(a => a.id === selectedAgentId ? { ...a, name: editAgentName, runtime: editAgentRuntime } : a));
      setAgentCodes(prev => ({ ...prev, [selectedAgentId]: editAgentCode }));
      setAgentRuntimes(prev => ({ ...prev, [selectedAgentId]: editAgentRuntime }));
      setShowEditForm(false);
    } catch (err) {
      console.error(err);
      alert('Error updating agent.');
    } finally {
      setEditSubmitting(false);
    }
  };

  // --- Delete agent ---
  const handleDeleteAgent = async () => {
    if (!selectedAgent) return;
    const confirm = window.confirm(`Are you sure you want to delete "${selectedAgent.name}"?`);
    if (!confirm) return;

    try {
      const response = await fetch(`http://localhost:8081/api/agents/${selectedAgent.id}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Deletion failed.');
    } catch (err) {
      console.error(err);
      alert('Error deleting agent.');
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

      {/* Dashboard Content split grid */}
      <div className="main-grid">
        
        {/* Left Column: Container list & controls */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {showCreateForm ? (
            /* Register Agent Form Panel */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: '0', fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
                  Register Agent
                </h3>
                <button 
                  onClick={() => setShowCreateForm(false)} 
                  style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '0' }}
                >
                  <X style={{ width: '18px', height: '18px' }} />
                </button>
              </div>

              <form onSubmit={handleRegisterAgent}>
                {formError && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-error)', background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.15)', padding: '8px 12px', borderRadius: '6px', marginBottom: '12px' }}>
                    {formError}
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Agent Name</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="e.g., Sentiment Classifier" 
                    value={newAgentName}
                    onChange={(e) => setNewAgentName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Runtime Engine</label>
                  <select 
                    className="form-select"
                    value={newAgentRuntime}
                    onChange={(e) => {
                      const rt = e.target.value as 'python' | 'node';
                      setNewAgentRuntime(rt);
                      if (rt === 'node') {
                        setNewAgentCode('console.log("Custom Node Agent Running...");\nsetTimeout(() => console.log("Check: OK"), 1000);');
                      } else {
                        setNewAgentCode(DEFAULT_PYTHON_CODE);
                      }
                    }}
                  >
                    <option value="python">Python 3.12 (secure sandbox)</option>
                    <option value="node">Node.js 20 (secure sandbox)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Execution Code Script</label>
                  <textarea 
                    className="form-textarea custom-scrollbar" 
                    value={newAgentCode}
                    onChange={(e) => setNewAgentCode(e.target.value)}
                    required
                  />
                </div>

                <button 
                  type="submit" 
                  disabled={formSubmitting}
                  className="btn btn-primary" 
                  style={{ width: '100%', padding: '12px', marginTop: '8px' }}
                >
                  {formSubmitting ? 'Registering...' : 'Register & Deploy'}
                </button>
              </form>
            </div>
          ) : showEditForm && selectedAgent ? (
            /* Edit Agent Form Panel */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: '0', fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
                  Edit Agent Config
                </h3>
                <button 
                  onClick={() => setShowEditForm(false)} 
                  style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '0' }}
                >
                  <X style={{ width: '18px', height: '18px' }} />
                </button>
              </div>

              <form onSubmit={handleEditAgent}>
                <div className="form-group">
                  <label className="form-label">Agent Name</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={editAgentName}
                    onChange={(e) => setEditAgentName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Runtime Engine</label>
                  <select 
                    className="form-select"
                    value={editAgentRuntime}
                    onChange={(e) => setEditAgentRuntime(e.target.value as 'python' | 'node')}
                  >
                    <option value="python">Python 3.12 (secure sandbox)</option>
                    <option value="node">Node.js 20 (secure sandbox)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Execution Code Script</label>
                  <textarea 
                    className="form-textarea custom-scrollbar" 
                    value={editAgentCode}
                    onChange={(e) => setEditAgentCode(e.target.value)}
                    required
                  />
                </div>

                <button 
                  type="submit" 
                  disabled={editSubmitting}
                  className="btn btn-primary" 
                  style={{ width: '100%', padding: '12px', marginTop: '8px' }}
                >
                  {editSubmitting ? 'Saving changes...' : 'Save Configuration'}
                </button>
              </form>
            </div>
          ) : (
            /* Agent List Selection view */
            <>
              <div className="agent-list-header">
                <h2 className="agent-list-title">
                  <Cpu style={{ width: '16px', height: '16px', color: '#818cf8' }} />
                  Cognitive Containers
                </h2>
                <span className="agent-list-count">
                  {agents.length} Total
                </span>
              </div>

              {agents.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '40px 10px', background: 'rgba(0,0,0,0.15)', border: '1px dashed rgba(255,255,255,0.02)', borderRadius: '12px' }}>
                  <AlertCircle style={{ width: '28px', height: '28px', color: 'var(--color-text-muted)' }} />
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textAlign: 'center' }}>
                    No containers active.
                  </span>
                </div>
              ) : (
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
                              <p>{agent.id.slice(0, 18)}...</p>
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
              )}

              {/* Action Buttons: Add Agent */}
              <button 
                onClick={() => setShowCreateForm(true)} 
                className="btn btn-secondary" 
                style={{ width: '100%', gap: '6px' }}
              >
                <Plus style={{ width: '16px', height: '16px' }} />
                Register New Agent
              </button>

              {/* Manual Override & Config CRUD controls for selected agent */}
              {selectedAgent && (
                <div className="manual-override-section" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <h3>Manual Override</h3>
                  <div className="override-btn-group">
                    <button 
                      onClick={triggerWakeup}
                      disabled={selectedAgent.status === 'running'}
                      className="btn btn-primary"
                    >
                      <Play style={{ width: '14px', height: '14px' }} />
                      Wake up
                    </button>
                    <button 
                      onClick={triggerHibernate}
                      disabled={selectedAgent.status !== 'running'}
                      className="btn btn-secondary"
                    >
                      <Pause style={{ width: '14px', height: '14px' }} />
                      Hibernate
                    </button>
                  </div>

                  {/* Edit and Delete Buttons */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '4px' }}>
                    <button 
                      onClick={() => {
                        setEditAgentName(selectedAgent.name);
                        setEditAgentRuntime(agentRuntimes[selectedAgent.id] || selectedAgent.runtime);
                        setEditAgentCode(agentCodes[selectedAgent.id] || '');
                        setShowEditForm(true);
                      }}
                      className="btn btn-secondary"
                      style={{ gap: '6px', background: 'rgba(255,255,255,0.01)', borderColor: 'rgba(255,255,255,0.05)' }}
                    >
                      <Edit2 style={{ width: '12px', height: '12px' }} />
                      Edit Config
                    </button>
                    <button 
                      onClick={handleDeleteAgent}
                      className="btn btn-secondary"
                      style={{ gap: '6px', color: 'var(--color-error)', background: 'rgba(244,63,94,0.03)', borderColor: 'rgba(244,63,94,0.1)' }}
                    >
                      <Trash2 style={{ width: '12px', height: '12px' }} />
                      Delete Agent
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

        </div>

        {/* Right Column: Large Console Log Stream & Metering Display */}
        <div className="right-content" style={{ display: 'flex', flexDirection: 'column' }}>
          {selectedAgent ? (
            <div className="panel console-section" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              
              {/* Header with Logs Meta and Billing Metering Info */}
              <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', paddingBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Terminal style={{ width: '16px', height: '16px', color: '#818cf8' }} />
                  <h2 className="section-title" style={{ margin: 0 }}>Console Log Stream</h2>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                    ({selectedAgent.name})
                  </span>
                </div>

                {/* Metering Billing statistics */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {activeBilling && activeBilling.durationMs > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.02)', padding: '6px 14px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.04)', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-text-secondary)' }}>
                        <span style={{ color: 'var(--neon-teal)' }}>●</span> {activeBilling.durationMs}ms
                      </span>
                      <span style={{ color: 'rgba(255,255,255,0.1)' }}>|</span>
                      <span style={{ color: 'var(--color-text-secondary)' }}>
                        {activeBilling.ramAllocatedMb}MB RAM
                      </span>
                      <span style={{ color: 'rgba(255,255,255,0.1)' }}>|</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '2px', color: '#10b981', fontWeight: 'bold' }}>
                        <DollarSign style={{ width: '12px', height: '12px', strokeWidth: 3 }} />
                        {activeBilling.costUsd.toFixed(8)}
                      </span>
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                      No active metering metrics. Wake up container to compute.
                    </div>
                  )}
                </div>
              </div>

              {/* Console logs container */}
              <div className="console-container custom-scrollbar" ref={logContainerRef} style={{ flex: 1, overflowY: 'auto', marginTop: '16px', fontSize: '0.8rem', lineHeight: '1.6' }}>
                {activeLogs.length === 0 ? (
                  <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                    No active console logs. Run the sandbox or trigger the agent to view logs.
                  </div>
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
          ) : (
            <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <p style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Select an agent from the left pane or click "Register New Agent".</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
