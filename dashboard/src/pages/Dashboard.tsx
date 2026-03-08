import { useQuery } from '@tanstack/react-query';
import { getSaasPartners, getMcpIntegrators, getHealth } from '../lib/api';

export default function Dashboard() {
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
  });

  const { data: saasPartners = [] } = useQuery({
    queryKey: ['saas-partners'],
    queryFn: getSaasPartners,
  });

  const { data: mcpIntegrators = [] } = useQuery({
    queryKey: ['mcp-integrators'],
    queryFn: getMcpIntegrators,
  });

  // Calculate stats
  const totalIntegrators = mcpIntegrators.length;
  const activeIntegrators = mcpIntegrators.filter(i => i.status === 'active').length;
  const totalEarnings = mcpIntegrators.reduce((sum, i) => sum + (i.totalEarnings || 0), 0);
  const totalDecisions = mcpIntegrators.reduce((sum, i) => sum + (i.decisionsCount || 0), 0);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-gray-400 mt-1">DRAE Earn MCP Attribution Protocol</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${health?.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-sm text-gray-400">
            {health?.status === 'healthy' ? 'System Healthy' : 'System Offline'}
          </span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="SaaS Partners"
          value={saasPartners.length}
          sublabel="Demand side"
          icon="🏢"
        />
        <StatCard
          label="MCP Integrators"
          value={`${activeIntegrators}/${totalIntegrators}`}
          sublabel="Active / Total"
          icon="🔌"
        />
        <StatCard
          label="Total Decisions"
          value={totalDecisions}
          sublabel="Tracked intents"
          icon="🎯"
        />
        <StatCard
          label="Total Earnings"
          value={`$${totalEarnings.toFixed(2)}`}
          sublabel="MCP developer payouts"
          icon="💰"
        />
      </div>

      {/* Revenue Split Visualization */}
      <div className="bg-gray-900/50 rounded-xl p-6 border border-gray-800">
        <h2 className="text-lg font-semibold mb-4">Revenue Split Model</h2>
        <div className="flex gap-2 h-8 rounded-lg overflow-hidden">
          <div className="bg-violet-500 flex-[70] flex items-center justify-center text-sm font-medium">
            70% MCP Dev
          </div>
          <div className="bg-purple-500 flex-[20] flex items-center justify-center text-sm font-medium">
            20% Attr
          </div>
          <div className="bg-fuchsia-500 flex-[10] flex items-center justify-center text-sm font-medium">
            10%
          </div>
        </div>
        <p className="text-gray-400 text-sm mt-3">
          Revenue is split: 70% to MCP developers, 20% to DRAE attribution, 10% platform fee
        </p>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SaaS Partners */}
        <div className="bg-gray-900/50 rounded-xl p-6 border border-gray-800">
          <h2 className="text-lg font-semibold mb-4">SaaS Partners (Demand)</h2>
          {saasPartners.length === 0 ? (
            <p className="text-gray-500 text-sm">No partners registered yet</p>
          ) : (
            <div className="space-y-3">
              {saasPartners.map(partner => (
                <div
                  key={partner.id}
                  className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg"
                >
                  <div>
                    <div className="font-medium">{partner.name}</div>
                    <div className="text-sm text-gray-400">
                      {(partner.defaultCommissionRate * 100).toFixed(0)}% commission
                    </div>
                  </div>
                  <StatusBadge status={partner.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* MCP Integrators */}
        <div className="bg-gray-900/50 rounded-xl p-6 border border-gray-800">
          <h2 className="text-lg font-semibold mb-4">MCP Integrators (Supply)</h2>
          {mcpIntegrators.length === 0 ? (
            <p className="text-gray-500 text-sm">No integrators registered yet</p>
          ) : (
            <div className="space-y-3">
              {mcpIntegrators.map(integrator => (
                <div
                  key={integrator.id}
                  className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg"
                >
                  <div>
                    <div className="font-medium">{integrator.name}</div>
                    <div className="text-sm text-gray-400">
                      {integrator.decisionsCount || 0} decisions · ${(integrator.totalEarnings || 0).toFixed(2)} earned
                    </div>
                  </div>
                  <StatusBadge status={integrator.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Architecture Diagram */}
      <div className="bg-gray-900/50 rounded-xl p-6 border border-gray-800">
        <h2 className="text-lg font-semibold mb-4">Attribution Flow</h2>
        <div className="flex items-center justify-center gap-4 py-8">
          <FlowStep step={1} label="MCP Tool" sublabel="Creates intent" />
          <FlowArrow />
          <FlowStep step={2} label="/intent API" sublabel="Signs token" />
          <FlowArrow />
          <FlowStep step={3} label="SaaS Partner" sublabel="Receives token" />
          <FlowArrow />
          <FlowStep step={4} label="/conversion" sublabel="Verifies & pays" />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sublabel,
  icon,
}: {
  label: string;
  value: string | number;
  sublabel: string;
  icon: string;
}) {
  return (
    <div className="bg-gray-900/50 rounded-xl p-5 border border-gray-800">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-400">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          <p className="text-xs text-gray-500 mt-1">{sublabel}</p>
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-500/20 text-green-400',
    pending: 'bg-yellow-500/20 text-yellow-400',
    suspended: 'bg-red-500/20 text-red-400',
    paused: 'bg-gray-500/20 text-gray-400',
  };

  return (
    <span className={`px-2 py-1 rounded-md text-xs font-medium ${colors[status] || colors.pending}`}>
      {status}
    </span>
  );
}

function FlowStep({ step, label, sublabel }: { step: number; label: string; sublabel: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-12 h-12 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-violet-400 font-bold">
        {step}
      </div>
      <div className="mt-2 font-medium text-sm">{label}</div>
      <div className="text-xs text-gray-500">{sublabel}</div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="text-gray-600">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 12h14M12 5l7 7-7 7" />
      </svg>
    </div>
  );
}
