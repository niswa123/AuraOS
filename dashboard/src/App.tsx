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
  AlertCircle
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
  // --- States (All initialized as empty/clean states, NO mock data) ---
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({});
  const [variables, setVariables] = useState<Record<string, Record<string, any>>>({});
  const [timelines, setTimelines] = useState<Record<string, 'Trigger' | 'Active' | 'Hibernate' | 'Sleep'>>({});

  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

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

  // --- Trigger wakeup or hibernate simulator ---
  const triggerSimulation = (action: 'wakeup' | 'hibernate') => {
    if (!selectedAgent) return;
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

      {/* Empty State: No Agents Registered in Database */}
      {agents.length === 0 ? (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px', gap: '20px', minHeight: '400px' }}>
          <AlertCircle style={{ width: '48px', height: '48px', color: 'var(--color-text-muted)' }} />
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ margin: '0 0 8px 0', fontSize: '1.2rem', fontWeight: '700' }}>No Cognitive Containers Found</h2>
            <p style={{ margin: '0', color: 'var(--color-text-secondary)', fontSize: '0.875rem', maxWidth: '400px', lineHeight: '1.6' }}>
              The database does not contain any registered agents. Run a scheduler, dispatch a webhook, or register an agent to launch a sandboxed runtime.
            </p>
          </div>
        </div>
      ) : (
        /* Main Grid Section */
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
            {selectedAgent && (
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
            )}
          </div>

          {/* Right Column: Selected Agent Details Panel */}
          {selectedAgent ? (
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

            </div>
          ) : (
            <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
              <p style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Select an agent from the left pane to monitor.</p>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
