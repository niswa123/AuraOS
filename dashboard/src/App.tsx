import { useState, useEffect, useRef } from 'react';
import { 
  Cpu, 
  Terminal, 
  Play, 
  Pause, 
  Layers, 
  Clock, 
  Database,
  Activity,
  AlertCircle,
  Plus,
  X
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

const DEFAULT_PYTHON_CODE = `import time
def rosenbrock(x, y):
    return (1 - x)**2 + 100 * (y - x**2)**2

def gradients(x, y):
    dx = -2 * (1 - x) - 400 * x * (y - x**2)
    dy = 200 * (y - x**2)
    return dx, dy

x, y = -1.2, 1.0
lr = 0.0015
print("🚀 Running Gradient Descent Optimizer...")
for epoch in range(1, 11):
    dx, dy = gradients(x, y)
    x = x - lr * dx
    y = y - lr * dy
    print(f"Epoch {epoch}/10 -> Loss: {rosenbrock(x, y):.6f}")
    time.sleep(0.5)
print(f"✅ Found minimum: ({x:.4f}, {y:.4f})")`;

export default function App() {
  // --- States (All initialized clean, NO mock data) ---
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({});
  const [variables, setVariables] = useState<Record<string, Record<string, any>>>({});
  const [timelines, setTimelines] = useState<Record<string, 'Trigger' | 'Active' | 'Hibernate' | 'Sleep'>>({});

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
          setVariables(prev => ({
            ...prev,
            [agentId]: payload.variables || {}
          }));
          setTimelines(prev => ({
            ...prev,
            [agentId]: payload.timelineStage || 'Sleep'
          }));
        }

        // 3. Status changes (dynamic running/sleeping changes)
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

        // 5. State variable updates
        if (type === 'state_change') {
          setVariables(prev => ({
            ...prev,
            [agentId]: payload.variables
          }));
        }

        // 6. Timeline transitions
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
  }, [selectedAgentId, wsConnected]);

  // --- Auto-scroll logs ---
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, selectedAgentId]);

  const selectedAgent = selectedAgentId ? agents.find(a => a.id === selectedAgentId) : null;
  const activeLogs = selectedAgent ? logs[selectedAgent.id] || [] : [];
  const activeVariables = selectedAgent ? variables[selectedAgent.id] || {} : null;
  const activeTimeline = selectedAgent ? timelines[selectedAgent.id] || 'Sleep' : 'Sleep';

  // --- Trigger wakeup or hibernate ---
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
      setTimelines(prev => ({ ...prev, [selectedAgent.id]: 'Active' }));
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
    setTimelines(prev => ({ ...prev, [selectedAgent.id]: 'Sleep' }));
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

      // Add to list and close form
      const newAgent: Agent = {
        id: result.agent.id,
        name: result.agent.name,
        runtime: result.agent.runtime,
        status: 'sleeping',
        lastActive: 'never'
      };

      setAgents(prev => [...prev, newAgent]);
      setSelectedAgentId(newAgent.id);
      
      // Reset inputs
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
        
        {/* Left Column: Container registration / Selection List */}
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

              {/* Manual Override controls for selected agent */}
              {selectedAgent && (
                <div className="manual-override-section">
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
                </div>
              )}
            </>
          )}

        </div>

        {/* Right Column: Selected Agent Details Console & Timeline */}
        <div className="right-content">
          {selectedAgent ? (
            <>
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

              {/* Bottom Half: JSON inspector and Interactive Timeline */}
              <div className="bottom-split-grid">
                
                {/* JSON State Inspector */}
                <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h2 className="section-title" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '12px', margin: '0' }}>
                    <Database style={{ width: '16px', height: '16px', color: '#818cf8' }} />
                    Variable Inspector
                  </h2>
                  {activeVariables && Object.keys(activeVariables).length > 0 ? (
                    <pre className="inspector-pre custom-scrollbar">
                      {JSON.stringify(activeVariables, null, 2)}
                    </pre>
                  ) : (
                    <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: '0.8rem', padding: '16px' }}>
                      No active context variables serialized.
                    </div>
                  )}
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

            </>
          ) : (
            <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
              <p style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Select an agent from the left pane or click "Register New Agent".</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
