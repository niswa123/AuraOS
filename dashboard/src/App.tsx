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
          setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: payload.status, lastActive: 'Active now' } : a));
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
    <div className="min-h-screen relative p-6 flex flex-col gap-6 overflow-hidden">
      {/* Background Ambience */}
      <div className="ambient-glow" style={{ top: '-10%', left: '10%' }}></div>
      <div className="ambient-glow" style={{ bottom: '-15%', right: '10%', background: 'radial-gradient(circle, rgba(20, 184, 166, 0.04) 0%, transparent 70%)' }}></div>

      {/* Header */}
      <header className="glass-panel p-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-indigo-600/10 border border-indigo-500/20 text-indigo-400">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-neutral-200 to-neutral-400 bg-clip-text text-transparent">AuraOS Control Center</h1>
            <p className="text-xs text-neutral-400">Agentic runtime environment & sandbox supervisor</p>
          </div>
        </div>

        {/* Live status indicators */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-neutral-900 border border-neutral-800 text-xs">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span>Database:</span>
            <span className="font-semibold text-emerald-400">Connected</span>
          </div>

          <div className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs transition-all ${
            wsConnected 
              ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-400' 
              : 'bg-yellow-950/20 border-yellow-500/30 text-yellow-400'
          }`}>
            <span className={`w-2.5 h-2.5 rounded-full ${wsConnected ? 'bg-emerald-400 active-ring' : 'bg-yellow-400 animate-pulse'}`}></span>
            <span>Live Stream:</span>
            <span className="font-semibold">{wsConnected ? 'Connected' : 'Offline (Polling)'}</span>
          </div>
        </div>
      </header>

      {/* Main Grid Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
        
        {/* Left Column: Agent Selection Grid */}
        <div className="glass-panel p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-indigo-400" />
              Cognitive Containers
            </h2>
            <span className="text-xs px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 font-mono text-neutral-400">
              {agents.length} Total
            </span>
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto max-h-[500px] pr-1 custom-scrollbar">
            {agents.map((agent) => {
              const isRunning = agent.status === 'running';
              const isSelected = agent.id === selectedAgentId;
              
              return (
                <div 
                  key={agent.id}
                  onClick={() => setSelectedAgentId(agent.id)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    isSelected 
                      ? 'bg-neutral-800/40 border-indigo-500/40 shadow-[0_0_15px_rgba(79,70,229,0.1)]' 
                      : 'bg-neutral-900/20 border-neutral-800/50 hover:bg-neutral-800/20'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {/* Neon indicator ring for active container */}
                      <div className="relative">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold ${
                          isRunning 
                            ? 'bg-teal-500/10 text-teal-400 border border-teal-500/30' 
                            : 'bg-neutral-800 text-neutral-400 border border-neutral-700/50'
                        }`}>
                          {agent.runtime === 'python' ? 'PY' : 'JS'}
                        </div>
                        <span className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border border-neutral-950 ${
                          isRunning 
                            ? 'bg-teal-400 active-ring' 
                            : agent.status === 'hibernating' 
                            ? 'bg-amber-400' 
                            : 'bg-neutral-500'
                        }`}></span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm text-neutral-100">{agent.name}</h3>
                        <p className="text-xs text-neutral-400 font-mono">{agent.id}</p>
                      </div>
                    </div>
                    <span className="text-[10px] text-neutral-500">{agent.lastActive}</span>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs pt-3 border-t border-neutral-800/30">
                    <span className="text-neutral-500">Status:</span>
                    <span className={`font-semibold capitalize px-2 py-0.5 rounded text-[10px] ${
                      isRunning 
                        ? 'bg-teal-950/30 text-teal-400 border border-teal-500/20' 
                        : agent.status === 'hibernating'
                        ? 'bg-amber-950/30 text-amber-400 border border-amber-500/20'
                        : 'bg-neutral-900 text-neutral-400 border border-neutral-800'
                    }`}>{agent.status}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick Actions Panel */}
          <div className="mt-auto pt-4 border-t border-neutral-800/50">
            <h3 className="text-xs font-semibold uppercase text-neutral-500 mb-3">Manual Override</h3>
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => triggerSimulation('wakeup')}
                disabled={selectedAgent.status === 'running'}
                className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-teal-600/10 hover:bg-teal-600/20 border border-teal-500/20 hover:border-teal-500/40 text-teal-400 text-xs font-medium transition-all disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                Wake up
              </button>
              <button 
                onClick={() => triggerSimulation('hibernate')}
                disabled={selectedAgent.status !== 'running'}
                className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 text-xs font-medium transition-all disabled:opacity-50"
              >
                <Pause className="w-3.5 h-3.5" />
                Hibernate
              </button>
            </div>
          </div>
        </div>

        {/* Center & Right Column Layout */}
        <div className="lg:col-span-2 flex flex-col gap-6">

          {/* Top Half: Log Stream Console */}
          <div className="glass-panel p-6 flex flex-col gap-3 flex-1 min-h-[300px]">
            <div className="flex items-center justify-between border-b border-neutral-800/60 pb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-indigo-400" />
                Console Log Stream
              </h2>
              <span className="text-[11px] font-mono text-neutral-500">
                Watching: {selectedAgent.name}
              </span>
            </div>

            <div 
              ref={logContainerRef}
              className="flex-1 bg-black/40 border border-neutral-900/80 rounded-lg p-4 console-font overflow-y-auto max-h-[250px] custom-scrollbar"
            >
              {activeLogs.length === 0 ? (
                <div className="text-neutral-500 italic">No output logs recorded for this agent.</div>
              ) : (
                activeLogs.map((log, index) => {
                  let colorClass = 'text-neutral-300';
                  if (log.stream === 'stderr' || log.message.toLowerCase().includes('error')) {
                    colorClass = 'text-rose-400 font-semibold';
                  } else if (log.message.toLowerCase().includes('warning') || log.message.toLowerCase().includes('timed out')) {
                    colorClass = 'text-amber-400';
                  } else if (log.stream === 'system') {
                    colorClass = 'text-indigo-400';
                  }

                  return (
                    <div key={index} className="mb-2 flex items-start gap-3">
                      <span className="text-neutral-600 select-none">[{log.timestamp}]</span>
                      <span className="text-neutral-500 font-semibold select-none">[{log.stream}]</span>
                      <span className={colorClass}>{log.message}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Bottom Half: JSON inspector and Interactive Timeline */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* JSON State Inspector */}
            <div className="glass-panel p-6 flex flex-col gap-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2 border-b border-neutral-800/60 pb-3">
                <Database className="w-4 h-4 text-indigo-400" />
                Variable Inspector
              </h2>
              <div className="flex-1 bg-black/30 rounded-lg p-4 border border-neutral-900/60 overflow-y-auto max-h-[200px] console-font custom-scrollbar">
                <pre className="text-xs text-indigo-300">
                  {JSON.stringify(activeVariables, null, 2)}
                </pre>
              </div>
            </div>

            {/* Interactive Timeline */}
            <div className="glass-panel p-6 flex flex-col gap-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2 border-b border-neutral-800/60 pb-3">
                <Clock className="w-4 h-4 text-indigo-400" />
                Chronos State Transitions
              </h2>
              
              <div className="flex-1 flex flex-col justify-center gap-6 py-2">
                {/* Horizontal progress visualization */}
                <div className="relative flex items-center justify-between w-full">
                  <div className="absolute left-0 right-0 h-0.5 bg-neutral-800 -z-10"></div>
                  
                  {/* Stages */}
                  {['Trigger', 'Active', 'Hibernate', 'Sleep'].map((stage, idx) => {
                    const stages = ['Trigger', 'Active', 'Hibernate', 'Sleep'];
                    const currentIdx = stages.indexOf(activeTimeline);
                    const isCompleted = idx <= currentIdx;
                    const isCurrent = activeTimeline === stage;

                    return (
                      <div key={stage} className="flex flex-col items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                          isCurrent 
                            ? 'bg-indigo-600 text-white border border-indigo-400 shadow-[0_0_12px_var(--accent-glow)]' 
                            : isCompleted
                            ? 'bg-neutral-800 text-indigo-400 border border-indigo-500/20'
                            : 'bg-neutral-900 text-neutral-600 border border-neutral-800'
                        }`}>
                          {idx + 1}
                        </div>
                        <span className={`text-[10px] font-semibold tracking-wide uppercase ${
                          isCurrent ? 'text-indigo-400' : 'text-neutral-500'
                        }`}>
                          {stage}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="text-xs text-neutral-400 text-center italic mt-2">
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
