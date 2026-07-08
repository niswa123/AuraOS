import { useState, useEffect, useRef } from 'react';
import { 
  Cpu, 
  Terminal, 
  Play, 
  Pause, 
  Activity,
  AlertCircle,
  Plus,
  X,
  Edit2,
  Trash2,
  DollarSign,
  Code,
  Terminal as ConsoleIcon,
  Check,
  Copy,
  Key,
  BookOpen
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

  // --- Playground Forms / Tabs States ---
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

  // --- PLG Integration Snippets Tabs ---
  const [integrationTab, setIntegrationTab] = useState<'code' | 'curl' | 'python' | 'ts'>('code');
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [showSdkModal, setShowSdkModal] = useState<boolean>(false);
  const [showDocsModal, setShowDocsModal] = useState<boolean>(false);
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState<boolean>(false);
  const [lastCopiedSdk, setLastCopiedSdk] = useState<'python' | 'ts' | null>(null);

  const mockApiKey = 'ao_test_3a8c1f9e2b774d8bb9a3efd85c414902';

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
    setIntegrationTab('code');
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
  const initiateDeleteAgent = () => {
    if (!selectedAgent) return;
    setAgentToDelete(selectedAgent);
    setShowDeleteModal(true);
  };

  const confirmDeleteAgent = async () => {
    if (!agentToDelete) return;
    setDeleteSubmitting(true);
    try {
      const response = await fetch(`http://localhost:8081/api/agents/${agentToDelete.id}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Deletion failed.');
      setShowDeleteModal(false);
      setAgentToDelete(null);
    } catch (err) {
      console.error(err);
      alert('Error deleting agent.');
    } finally {
      setDeleteSubmitting(false);
    }
  };

  // --- Copy Helper ---
  const handleCopy = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(type);
    if (type === 'pip') {
      setLastCopiedSdk('python');
    } else if (type === 'npm') {
      setLastCopiedSdk('ts');
    }
    setTimeout(() => setCopiedText(null), 2000);
  };

  // --- Snippet Generators ---
  const getCurlSnippet = () => {
    return `curl -X POST http://localhost:8081/webhook/${selectedAgentId || 'agent-id'} \\
  -H "Content-Type: application/json" \\
  -H "X-AuraOS-Token: ${mockApiKey}" \\
  -d '{"input_query": "Optimize metrics"}'`;
  };

  const getPythonSnippet = () => {
    return `from auraos import Sandbox

# Initialize sandbox container dynamically
sb = Sandbox(
    runtime="${selectedAgent?.runtime || 'python'}",
    api_key="${mockApiKey}"
)

# Dispatch agent execution cycle
result = sb.run("""
${agentCodes[selectedAgentId || ''] || '# Code snippet placeholder'}
""")

print("Stdout:", result.stdout)
if result.exit_code != 0:
    print("Error:", result.stderr)`;
  };

  const getTsSnippet = () => {
    return `import { Sandbox } from '@auraos/sdk';

const sb = new Sandbox({
  runtime: '${selectedAgent?.runtime || 'python'}',
  apiKey: '${mockApiKey}'
});

// Dispatch agent execution cycle
const result = await sb.run(\`
${agentCodes[selectedAgentId || ''] || '// Code snippet placeholder'}
\`);

console.log('Output logs:', result.stdout);`;
  };

  return (
    <div className="dashboard-wrapper">
      {/* Background Ambience */}
      <div className="ambient-glow" style={{ top: '-10%', left: '10%' }}></div>
      <div className="ambient-glow" style={{ bottom: '-15%', right: '10%', background: 'radial-gradient(circle, rgba(45, 212, 191, 0.04) 0%, transparent 70%)' }}></div>

      {/* Header */}
      <header className="panel header-container">
        <div className="header-logo-group">
          <div className="header-icon" style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" style={{ width: '100%', height: '100%' }}>
              <defs>
                <linearGradient id="auraGradHeader" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#00F0FF" />
                  <stop offset="100%" stopColor="#4F46E5" />
                </linearGradient>
                <linearGradient id="coreGradHeader" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#4F46E5" />
                  <stop offset="100%" stopColor="#6366F1" />
                </linearGradient>
                <filter id="glowHeader" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <circle cx="50" cy="50" r="38" stroke="url(#auraGradHeader)" strokeWidth="5" strokeLinecap="round" strokeDasharray="160 50" filter="url(#glowHeader)" />
              <polygon points="50,22 74,36 74,64 50,78 26,64 26,36" fill="url(#coreGradHeader)" opacity="0.95" />
              <path d="M50,33 L62,59 M50,33 L38,59 M42,51 L58,51" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="header-title-text">
            <h1>AuraOS Control Center</h1>
            <p>Agentic runtime environment & sandbox supervisor</p>
          </div>
        </div>

        {/* Live status indicators */}
        <div className="status-badge-group" style={{ gap: '12px' }}>
          <button 
            onClick={() => setShowDocsModal(true)} 
            className="btn btn-secondary" 
            style={{ padding: '6px 12px', fontSize: '0.75rem', gap: '6px', background: 'rgba(16, 185, 129, 0.08)', borderColor: 'rgba(16, 185, 129, 0.2)' }}
          >
            <BookOpen style={{ width: '12px', height: '12px', color: '#10b981' }} />
            Docs & Reference
          </button>

          <button 
            onClick={() => setShowSdkModal(true)} 
            className="btn btn-secondary" 
            style={{ padding: '6px 12px', fontSize: '0.75rem', gap: '6px', background: 'rgba(99, 102, 241, 0.08)', borderColor: 'rgba(99, 102, 241, 0.2)' }}
          >
            <Key style={{ width: '12px', height: '12px', color: '#818cf8' }} />
            API Keys & SDK
          </button>

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
                  Deploy Playground Sandbox
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
                  <label className="form-label">Sandbox Name</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="e.g., Sentiment Classifier Sandbox" 
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
                  <label className="form-label">Test Script Code</label>
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
                  {formSubmitting ? 'Deploying...' : 'Deploy Playground'}
                </button>
              </form>
            </div>
          ) : showEditForm && selectedAgent ? (
            /* Edit Agent Form Panel */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: '0', fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
                  Edit Sandbox Config
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
                  <label className="form-label">Sandbox Name</label>
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
                  <label className="form-label">Test Script Code</label>
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
                  Playground Sandboxes
                </h2>
                <span className="agent-list-count">
                  {agents.length} Active
                </span>
              </div>

              {agents.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '40px 10px', background: 'rgba(0,0,0,0.15)', border: '1px dashed rgba(255,255,255,0.02)', borderRadius: '12px' }}>
                  <AlertCircle style={{ width: '28px', height: '28px', color: 'var(--color-text-muted)' }} />
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textAlign: 'center' }}>
                    No sandboxes deployed.
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
                New Playground Sandbox
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
                      onClick={initiateDeleteAgent}
                      className="btn btn-secondary"
                      style={{ gap: '6px', color: 'var(--color-error)', background: 'rgba(244,63,94,0.03)', borderColor: 'rgba(244,63,94,0.1)' }}
                    >
                      <Trash2 style={{ width: '12px', height: '12px' }} />
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

        </div>

        {/* Right Column: Console Terminal or Integration API Code Snippets */}
        <div className="right-content" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {selectedAgent ? (
            <>
              {/* API Integration Tab Group Selector */}
              <div className="panel" style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    onClick={() => setIntegrationTab('code')}
                    className={`btn ${integrationTab === 'code' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '6px 12px', fontSize: '0.75rem', gap: '6px' }}
                  >
                    <Code style={{ width: '12px', height: '12px' }} />
                    Interactive Sandbox
                  </button>
                  
                  <button 
                    onClick={() => setIntegrationTab('curl')}
                    className={`btn ${integrationTab === 'curl' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '6px 12px', fontSize: '0.75rem', gap: '6px' }}
                  >
                    <ConsoleIcon style={{ width: '12px', height: '12px' }} />
                    cURL API
                  </button>

                  <button 
                    onClick={() => setIntegrationTab('python')}
                    className={`btn ${integrationTab === 'python' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '6px 12px', fontSize: '0.75rem', gap: '6px' }}
                  >
                    Python SDK
                  </button>

                  <button 
                    onClick={() => setIntegrationTab('ts')}
                    className={`btn ${integrationTab === 'ts' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '6px 12px', fontSize: '0.75rem', gap: '6px' }}
                  >
                    TypeScript SDK
                  </button>
                </div>

                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
                  Sandbox ID: {selectedAgent.id}
                </span>
              </div>

              {/* Conditionally render: Sandbox Terminal logs or Egress Code snippets */}
              {integrationTab === 'code' ? (
                /* Terminal Console Log Stream */
                <div className="panel console-section" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  
                  <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', paddingBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Terminal style={{ width: '16px', height: '16px', color: '#818cf8' }} />
                      <h2 className="section-title" style={{ margin: 0 }}>Console Log Stream</h2>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                        ({selectedAgent.name})
                      </span>
                    </div>

                    {/* Telemetry / Billing Indicators */}
                    <div>
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
                          Wake up container to compute execution billing metrics.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Logs terminal block */}
                  <div className="console-container custom-scrollbar" ref={logContainerRef} style={{ flex: 1, overflowY: 'auto', marginTop: '16px', fontSize: '0.8rem', lineHeight: '1.6' }}>
                    {activeLogs.length === 0 ? (
                      <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                        No active logs. Click "Wake up" to execute script in secure sandbox.
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
                /* Egress API / SDK Integration Snippet Panel */
                <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', minHeight: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 className="section-title" style={{ margin: 0 }}>
                      {integrationTab === 'curl' && 'API cURL Request Template'}
                      {integrationTab === 'python' && 'Python SDK Integration'}
                      {integrationTab === 'ts' && 'TypeScript SDK Integration'}
                    </h2>
                    
                    <button 
                      onClick={() => {
                        const snip = integrationTab === 'curl' 
                          ? getCurlSnippet() 
                          : integrationTab === 'python' 
                          ? getPythonSnippet() 
                          : getTsSnippet();
                        handleCopy(snip, integrationTab);
                      }}
                      className="btn btn-secondary"
                      style={{ padding: '6px 12px', fontSize: '0.75rem', gap: '6px' }}
                    >
                      {copiedText === integrationTab ? (
                        <>
                          <Check style={{ width: '12px', height: '12px', color: '#10b981' }} />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy style={{ width: '12px', height: '12px' }} />
                          Copy Snippet
                        </>
                      )}
                    </button>
                  </div>

                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-secondary)', lineHeight: '1.5' }}>
                    {integrationTab === 'curl' && 'Call your secure sandbox webhook directly via HTTP to trigger execution cycles from external services like GitHub actions or Supabase database listeners.'}
                    {integrationTab === 'python' && 'Integrate sandboxed runtimes natively inside your python backend. Secure cgroup boundaries clamp resource usage and keep execution thread-safe.'}
                    {integrationTab === 'ts' && 'Launch node or python agents inside sandboxed runtimes using our npm SDK wrapper. Safe, fast, and scalable.'}
                  </p>

                  <pre className="inspector-pre custom-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '16px', margin: 0, fontSize: '0.75rem', lineHeight: '1.6', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.02)' }}>
                    {integrationTab === 'curl' && getCurlSnippet()}
                    {integrationTab === 'python' && getPythonSnippet()}
                    {integrationTab === 'ts' && getTsSnippet()}
                  </pre>
                </div>
              )}
            </>
          ) : (
            <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <p style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Select a sandbox playground from the sidebar or click "New Playground Sandbox".</p>
            </div>
          )}
        </div>

      </div>

      {/* API Keys & SDK setup Modal Dialog */}
      {showSdkModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div className="panel" style={{ maxWidth: '540px', width: '90%', padding: '24px', position: 'relative', display: 'flex', flexDirection: 'column', gap: '20px', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
            
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Key style={{ width: '18px', height: '18px', color: '#818cf8' }} />
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 'bold' }}>AuraOS Developer Setup</h3>
              </div>
              <button 
                onClick={() => setShowSdkModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0 }}
              >
                <X style={{ width: '18px', height: '18px' }} />
              </button>
            </div>

            {/* API Key box */}
            <div>
              <label className="form-label" style={{ marginBottom: '8px', display: 'block' }}>Your Developer API Key</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input 
                  type="text" 
                  readOnly 
                  value={mockApiKey} 
                  className="form-input" 
                  style={{ fontFamily: 'monospace', fontSize: '0.75rem', background: 'rgba(0,0,0,0.6)' }}
                />
                <button 
                  onClick={() => handleCopy(mockApiKey, 'key')}
                  className="btn btn-secondary"
                  style={{ padding: '0 16px', fontSize: '0.75rem', gap: '6px' }}
                >
                  {copiedText === 'key' ? <Check style={{ width: '14px', height: '14px', color: '#10b981' }} /> : <Copy style={{ width: '14px', height: '14px' }} />}
                </button>
              </div>
            </div>

            {/* SDK setup block */}
            {(() => {
              const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
              const pipCommand = isDev ? 'pip install -e ./sdk/python' : 'pip install auraos';
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <label className="form-label">Install SDK Packages</label>
                  
                  {/* Python setup */}
                  <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--color-text-secondary)' }}>{pipCommand}</span>
                    <button 
                      onClick={() => handleCopy(pipCommand, 'pip')}
                      style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}
                    >
                      {copiedText === 'pip' ? <Check style={{ width: '14px', height: '14px', color: '#10b981' }} /> : <Copy style={{ width: '14px', height: '14px' }} />}
                    </button>
                  </div>

                  {/* Node setup */}
                  <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--color-text-secondary)' }}>npm install @auraos/sdk</span>
                    <button 
                      onClick={() => handleCopy('npm install @auraos/sdk', 'npm')}
                      style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}
                    >
                      {copiedText === 'npm' ? <Check style={{ width: '14px', height: '14px', color: '#10b981' }} /> : <Copy style={{ width: '14px', height: '14px' }} />}
                    </button>
                  </div>
                </div>
              );
            })()}

            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)', lineHeight: '1.5' }}>
              Create API keys and instantiate container sandboxes natively inside your editor context. The playground UI above is mapped to the same execution pools.
            </p>

            <button 
              onClick={() => {
                setShowSdkModal(false);
                if (lastCopiedSdk === 'python') {
                  setIntegrationTab('python');
                } else if (lastCopiedSdk === 'ts') {
                  setIntegrationTab('ts');
                }
                setLastCopiedSdk(null);
              }}
              className="btn btn-primary"
              style={{ width: '100%', padding: '10px 0' }}
            >
              Done
            </button>

          </div>
        </div>
      )}
      {/* Custom Delete Confirmation Modal */}
      {showDeleteModal && agentToDelete && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div className="panel" style={{ maxWidth: '440px', width: '90%', padding: '24px', position: 'relative', display: 'flex', flexDirection: 'column', gap: '20px', border: '1px solid rgba(244, 63, 94, 0.25)' }}>
            
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Trash2 style={{ width: '18px', height: '18px', color: 'var(--color-error)' }} />
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 'bold', color: 'var(--color-text-secondary)' }}>Delete Sandbox</h3>
              </div>
              <button 
                onClick={() => { setShowDeleteModal(false); setAgentToDelete(null); }}
                style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0 }}
              >
                <X style={{ width: '18px', height: '18px' }} />
              </button>
            </div>

            {/* Modal Body */}
            <div>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-secondary)', lineHeight: '1.6' }}>
                Are you sure you want to permanently delete playground sandbox <strong style={{ color: '#fff' }}>"{agentToDelete.name}"</strong>? 
                This will terminate the execution session and cascade delete all metrics.
              </p>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '12px', marginTop: '8px' }}>
              <button 
                onClick={() => { setShowDeleteModal(false); setAgentToDelete(null); }}
                className="btn btn-secondary"
                style={{ padding: '10px 0', fontSize: '0.8rem' }}
              >
                Cancel
              </button>
              <button 
                onClick={confirmDeleteAgent}
                disabled={deleteSubmitting}
                className="btn btn-primary"
                style={{ 
                  padding: '10px 0', 
                  fontSize: '0.8rem', 
                  color: '#fff',
                  background: 'linear-gradient(135deg, #f43f5e 0%, #be123c 100%)', 
                  borderColor: 'rgba(244, 63, 94, 0.4)',
                  boxShadow: '0 0 12px rgba(244, 63, 94, 0.2)' 
                }}
              >
                {deleteSubmitting ? 'Deleting...' : 'Delete Sandbox'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Docs & Reference Modal */}
      {showDocsModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div className="panel" style={{ maxWidth: '780px', width: '90%', maxHeight: '85vh', padding: '28px', position: 'relative', display: 'flex', flexDirection: 'column', border: '1px solid rgba(16, 185, 129, 0.2)', overflow: 'hidden' }}>
            
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BookOpen style={{ width: '20px', height: '20px', color: '#10b981' }} />
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 'bold', color: '#fff' }}>AuraOS Documentation & Reference</h3>
              </div>
              <button 
                onClick={() => setShowDocsModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0 }}
              >
                <X style={{ width: '18px', height: '18px' }} />
              </button>
            </div>

            {/* Scrollable Modal Content */}
            <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', paddingRight: '16px', marginTop: '20px', marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '20px', fontSize: '0.8rem', lineHeight: '1.6', color: 'var(--color-text-secondary)' }}>
              
              {/* Section 1 */}
              <div>
                <h4 style={{ color: '#fff', fontSize: '0.9rem', marginBottom: '8px', fontWeight: 'bold' }}>1. Local SDK Installation</h4>
                <p style={{ margin: '0 0 8px 0' }}>Install package locally inside your terminal from repository root:</p>
                <pre style={{ background: 'rgba(0,0,0,0.4)', padding: '12px', borderRadius: '6px', fontFamily: 'monospace', color: 'var(--neon-teal)', border: '1px solid rgba(255,255,255,0.03)' }}>
                  pip install -e ./sdk/python
                </pre>
              </div>

              {/* Section 2 */}
              <div>
                <h4 style={{ color: '#fff', fontSize: '0.9rem', marginBottom: '8px', fontWeight: 'bold' }}>2. SDK Sandbox Integration Code</h4>
                <p style={{ margin: '0 0 8px 0' }}>Instantiate container sandboxes programmatically in Python:</p>
                <pre style={{ background: 'rgba(0,0,0,0.4)', padding: '12px', borderRadius: '6px', fontFamily: 'monospace', color: 'var(--color-text-secondary)', border: '1px solid rgba(255,255,255,0.03)', overflowX: 'auto' }}>
{`from auraos import Sandbox

sb = Sandbox(runtime="python", api_key="${mockApiKey}")

# Run code in secure Docker container sandbox
result = sb.run("""
import time
print("Running container process cycle...")
time.sleep(1)
""")

print("Stdout:", result.stdout)
print("Duration:", result.duration_ms, "ms")`}
                </pre>
              </div>

              {/* Section 3 */}
              <div>
                <h4 style={{ color: '#fff', fontSize: '0.9rem', marginBottom: '8px', fontWeight: 'bold' }}>3. REST API Gateway Router</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.02)', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <th style={{ padding: '8px', fontWeight: 'bold', color: '#fff' }}>Route / Endpoint</th>
                      <th style={{ padding: '8px', fontWeight: 'bold', color: '#fff' }}>Method</th>
                      <th style={{ padding: '8px', fontWeight: 'bold', color: '#fff' }}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '8px', fontFamily: 'monospace', color: 'var(--neon-teal)' }}>/api/sandboxes</td>
                      <td style={{ padding: '8px', fontWeight: 'bold', color: '#818cf8' }}>POST</td>
                      <td style={{ padding: '8px' }}>Execute ad-hoc code in sandbox synchronously</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '8px', fontFamily: 'monospace', color: 'var(--neon-teal)' }}>/api/agents</td>
                      <td style={{ padding: '8px', fontWeight: 'bold', color: '#818cf8' }}>POST</td>
                      <td style={{ padding: '8px' }}>Register new persistent agent script</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '8px', fontFamily: 'monospace', color: 'var(--neon-teal)' }}>/webhook/:agentId</td>
                      <td style={{ padding: '8px', fontWeight: 'bold', color: '#818cf8' }}>POST</td>
                      <td style={{ padding: '8px' }}>Trigger registered agent execution (async)</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '8px', fontFamily: 'monospace', color: 'var(--neon-teal)' }}>/webhook/db-change</td>
                      <td style={{ padding: '8px', fontWeight: 'bold', color: '#818cf8' }}>POST</td>
                      <td style={{ padding: '8px' }}>Simulate database mutation trigger (Supabase)</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Section 4 */}
              <div>
                <h4 style={{ color: '#fff', fontSize: '0.9rem', marginBottom: '8px', fontWeight: 'bold' }}>4. Sandbox Security Controls</h4>
                <p style={{ margin: 0 }}>
                  Sandbox containers run with strict resource caps to prevent host exhaustion. The hard boundary defaults are:
                  RAM: <strong style={{ color: '#fff' }}>128MB</strong> (swap disabled) | CPU: <strong style={{ color: '#fff' }}>0.5 core</strong> | Timeout: <strong style={{ color: '#fff' }}>15s</strong> | Network: <strong style={{ color: '#fff' }}>Egress Whitelist (port 8086)</strong>
                </p>
              </div>

            </div>

            {/* Modal Footer */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
              <button 
                onClick={() => setShowDocsModal(false)}
                className="btn btn-primary"
                style={{ 
                  minWidth: '100px', 
                  padding: '8px 16px', 
                  color: '#fff',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
                  borderColor: 'rgba(16, 185, 129, 0.4)' 
                }}
              >
                Close Docs
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
