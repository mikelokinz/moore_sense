import React, { useEffect, useRef } from 'react';
import { X, WifiOff, AlertTriangle, Anchor, Info, Compass, ShieldAlert, Globe } from 'lucide-react';
import type { BuoyLocation } from '../../services/buoy/buoyTypes';
import { analyzeBuoyEEZ } from '../../utils/eezJurisdiction';

interface OfflineBuoysModalProps {
  isOpen: boolean;
  onClose: () => void;
  buoys: BuoyLocation[];
  onSelectBuoy?: (buoy: BuoyLocation) => void;
}

export interface OfflineStationDetail {
  id: string;
  disposition: 'PURPOSEFULLY_REMOVED' | 'LOST';
  dispositionLabel: string;
  reason: string;
  details: string;
  dateRemovedOrLost: string;
  vesselOrEvent: string;
  depthMeters: number;
  lastKnownPos: string;
  basin: string;
  incoisSilence: string;
  incoisLastEpoch: string;
}

export const OFFLINE_STATION_REGISTRY: Record<string, OfflineStationDetail> = {
  'OMNI-AD06': {
    id: 'OMNI-AD06',
    disposition: 'LOST',
    dispositionLabel: 'LOST AT SEA',
    reason: 'Mooring Line Failure / Storm Breakaway',
    details:
      'Catastrophic fairlead mooring link parted under heavy monsoonal wave dynamics and cyclical current shear in the North Arabian Sea. Surface buoy drifted outside its mooring watch circle; satellite transmitter battery depleted after 48h drifting. Classified lost at sea.',
    dateRemovedOrLost: '06 Jun 2026',
    vesselOrEvent: 'Arabian Sea Monsoon Severe Weather Event',
    depthMeters: 3150,
    lastKnownPos: '18.4950° N, 67.4500° E',
    basin: 'ARABIAN SEA',
    incoisSilence: '3,136 hours (130 days)',
    incoisLastEpoch: '2026-06-06 21:00 UTC',
  },
  'OMNI-AD07': {
    id: 'OMNI-AD07',
    disposition: 'PURPOSEFULLY_REMOVED',
    dispositionLabel: 'PURPOSEFULLY REMOVED',
    reason: 'Scheduled Drydock Maintenance & Recalibration',
    details:
      'Safely retrieved and unmoored by Ocean Research Vessel (ORV Sagar Nidhi) as part of scheduled biennial maintenance. Transported to NIOT Marine Operations Facility for CTD sensor suite recalibration, hull biofouling clearing, and acoustic release mechanism overhaul.',
    dateRemovedOrLost: '13 Oct 2026',
    vesselOrEvent: 'ORV Sagar Nidhi (NIOT Mission Cruise 84)',
    depthMeters: 2840,
    lastKnownPos: '14.9314° N, 68.9758° E',
    basin: 'ARABIAN SEA',
    incoisSilence: '52.5 hours (>2 days)',
    incoisLastEpoch: '2026-10-13 09:00 UTC',
  },
  'OMNI-BD09': {
    id: 'OMNI-BD09',
    disposition: 'PURPOSEFULLY_REMOVED',
    dispositionLabel: 'PURPOSEFULLY REMOVED',
    reason: 'Decommissioned / Research Program Concluded',
    details:
      'Decommissioned according to planned operational schedule following successful completion of the 5-year Bay of Bengal Air-Sea Interaction Observation Campaign. All meteorological and sub-surface sensors were successfully recovered.',
    dateRemovedOrLost: '24 Jul 2025',
    vesselOrEvent: 'NIOT Deep-Sea Mooring Operations Fleet',
    depthMeters: 2310,
    lastKnownPos: '17.4997° N, 89.1167° E',
    basin: 'BAY OF BENGAL',
    incoisSilence: '10,765 hours (>1 year)',
    incoisLastEpoch: '2025-07-24 00:00 UTC',
  },
};

export function OfflineBuoysModal({
  isOpen,
  onClose,
  buoys,
  onSelectBuoy,
}: OfflineBuoysModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on Outside Click or Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      if (modalRef.current && modalRef.current.contains(target)) {
        return;
      }
      if (target.closest('[data-buoy-trigger="offline"]')) {
        return;
      }
      onClose();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const timer = setTimeout(() => {
      window.addEventListener('pointerdown', handleOutsideClick, { capture: true });
      window.addEventListener('mousedown', handleOutsideClick, { capture: true });
    }, 40);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', handleOutsideClick, { capture: true });
      window.removeEventListener('mousedown', handleOutsideClick, { capture: true });
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      style={{
        position: 'fixed',
        top: '20px',
        left: '260px',
        width: '520px',
        maxWidth: 'calc(100vw - 290px)',
        maxHeight: 'calc(100vh - 40px)',
        background: 'linear-gradient(145deg, rgba(35, 8, 16, 0.88) 0%, rgba(20, 6, 12, 0.94) 100%)',
        backdropFilter: 'blur(30px) saturate(220%)',
        WebkitBackdropFilter: 'blur(30px) saturate(220%)',
        border: '1px solid rgba(251, 113, 133, 0.45)',
        borderTop: '1px solid rgba(255, 255, 255, 0.7)',
        borderRadius: '18px',
        boxShadow: '0 25px 60px rgba(0, 0, 0, 0.85), inset 0 1.5px 2px rgba(255, 255, 255, 0.4), 0 0 35px rgba(244, 63, 94, 0.25)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        color: '#f8fafc',
        fontFamily: "'Space Grotesk', system-ui, sans-serif",
        animation: 'slideInFromLeft 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(244, 63, 94, 0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(180deg, rgba(244, 63, 94, 0.15) 0%, transparent 100%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '8px',
              background: 'rgba(244, 63, 94, 0.2)',
              border: '1px solid rgba(244, 63, 94, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <WifiOff size={16} color="#fb7185" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  letterSpacing: '0.14em',
                  color: '#ffffff',
                }}
              >
                OFFLINE BUOYS
              </span>
              <span
                style={{
                  background: 'rgba(244, 63, 94, 0.25)',
                  border: '1px solid rgba(244, 63, 94, 0.5)',
                  color: '#fda4af',
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '1px 7px',
                  borderRadius: '12px',
                  fontFamily: 'monospace',
                }}
              >
                {buoys.length} INACTIVE
              </span>
            </div>
            <div
              style={{
                fontSize: '9.5px',
                color: 'rgba(148, 163, 184, 0.85)',
                fontFamily: 'monospace',
                marginTop: '2px',
              }}
            >
              PURPOSEFULLY REMOVED &amp; LOST MOORING INVENTORY
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '50%',
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#94a3b8',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)';
            e.currentTarget.style.color = '#ffffff';
            e.currentTarget.style.borderColor = '#ef4444';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
            e.currentTarget.style.color = '#94a3b8';
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
          }}
          title="Close Offline Buoys"
        >
          <X size={15} />
        </button>
      </div>

      {/* Offline Buoys Cards */}
      <div
        style={{
          padding: '14px 18px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          maxHeight: 'calc(100vh - 200px)',
        }}
      >
        {buoys.map((buoy) => {
          const detail = OFFLINE_STATION_REGISTRY[buoy.id] || {
            id: buoy.id,
            disposition: 'PURPOSEFULLY_REMOVED' as const,
            dispositionLabel: 'PURPOSEFULLY REMOVED',
            reason: 'Scheduled Overhaul / Decommissioned',
            details: 'Station temporarily retrieved or retired from active grid by NIOT.',
            dateRemovedOrLost: 'Prior season',
            vesselOrEvent: 'NIOT Fleet Operations',
            depthMeters: 2600,
            basin: (buoy.id.includes('BD') || buoy.longitude > 77.5) ? 'BAY OF BENGAL' : 'ARABIAN SEA',
            incoisSilence: 'Telemetry Inactive',
            incoisLastEpoch: 'Registry Archival',
          };

          const isLost = detail.disposition === 'LOST';

          return (
            <div
              key={buoy.id}
              style={{
                background: isLost
                  ? 'linear-gradient(135deg, rgba(225, 29, 72, 0.18) 0%, rgba(15, 23, 42, 0.75) 100%)'
                  : 'linear-gradient(135deg, rgba(234, 179, 8, 0.14) 0%, rgba(15, 23, 42, 0.75) 100%)',
                border: isLost
                  ? '1px solid rgba(244, 63, 94, 0.45)'
                  : '1px solid rgba(234, 179, 8, 0.45)',
                borderRadius: '12px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                transition: 'all 0.2s ease',
                boxShadow: isLost
                  ? '0 4px 18px rgba(225, 29, 72, 0.15)'
                  : '0 4px 18px rgba(234, 179, 8, 0.1)',
              }}
            >
              {/* Header: Station Name + Disposition Badge */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: '#ffffff',
                      fontFamily: 'monospace',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {buoy.id}
                  </span>
                  <span
                    style={{
                      fontSize: '8.5px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: 'rgba(255, 255, 255, 0.08)',
                      color: '#94a3b8',
                      fontFamily: 'monospace',
                    }}
                  >
                    {detail.basin}
                  </span>
                </div>

                {/* Primary Disposition Badge */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '3px 9px',
                    borderRadius: '20px',
                    fontSize: '9.5px',
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    fontFamily: 'monospace',
                    background: isLost ? 'rgba(225, 29, 72, 0.3)' : 'rgba(234, 179, 8, 0.25)',
                    border: isLost
                      ? '1px solid rgba(244, 63, 94, 0.8)'
                      : '1px solid rgba(234, 179, 8, 0.8)',
                    color: isLost ? '#fda4af' : '#fef08a',
                    boxShadow: isLost
                      ? '0 0 12px rgba(244, 63, 94, 0.35)'
                      : '0 0 12px rgba(234, 179, 8, 0.25)',
                  }}
                >
                  {isLost ? <ShieldAlert size={12} color="#f43f5e" /> : <Anchor size={12} color="#eab308" />}
                  <span>{detail.dispositionLabel}</span>
                </div>
              </div>

              {/* Specific Reason */}
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: isLost ? '#fca5a5' : '#fde047',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <AlertTriangle size={12} color={isLost ? '#f87171' : '#eab308'} />
                <span>{detail.reason}</span>
              </div>

              {/* Incident / Circumstance Description */}
              <div
                style={{
                  fontSize: '10px',
                  color: '#cbd5e1',
                  lineHeight: '1.45',
                  background: 'rgba(0, 0, 0, 0.35)',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                }}
              >
                {detail.details}
              </div>

              {/* Metadata Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '6px',
                  fontSize: '9.5px',
                  fontFamily: 'monospace',
                  color: '#94a3b8',
                  marginTop: '2px',
                }}
              >
                <div>
                  <span style={{ color: '#64748b' }}>DATE: </span>
                  <span style={{ color: '#ffffff', fontWeight: 600 }}>{detail.dateRemovedOrLost}</span>
                </div>
                <div>
                  <span style={{ color: '#64748b' }}>DEPTH: </span>
                  <span style={{ color: '#ffffff', fontWeight: 600 }}>{detail.depthMeters} m</span>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <span style={{ color: '#64748b' }}>COORDINATES: </span>
                  <span style={{ color: '#38bdf8', fontWeight: 600 }}>{detail.lastKnownPos}</span>
                </div>
                {(() => {
                  const eezInfo = analyzeBuoyEEZ(buoy);
                  return (
                    <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: '#64748b' }}>EEZ STATUS: </span>
                      <span
                        style={{
                          fontSize: '8px',
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: '3px',
                          background: eezInfo.badgeBg,
                          color: eezInfo.badgeColor,
                          border: `1px solid ${eezInfo.badgeBorder}`,
                        }}
                      >
                        {eezInfo.statusBadge} ({eezInfo.distanceToEEZBoundaryNM > 0 ? `${eezInfo.distanceToEEZBoundaryNM.toFixed(1)} NM off EEZ` : 'In EEZ'})
                      </span>
                      <span style={{ color: '#94a3b8', fontSize: '8px' }}>
                        {eezInfo.subSector}
                      </span>
                    </div>
                  );
                })()}
                <div style={{ gridColumn: 'span 2' }}>
                  <span style={{ color: '#64748b' }}>OPERATIONAL NOTE: </span>
                  <span style={{ color: '#e2e8f0' }}>{detail.vesselOrEvent}</span>
                </div>
                <div
                  style={{
                    gridColumn: 'span 2',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'rgba(239, 68, 68, 0.08)',
                    padding: '4px 8px',
                    borderRadius: '5px',
                    border: '1px solid rgba(239, 68, 68, 0.22)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: '#f87171', fontWeight: 700 }}>INCOIS AUDIT:</span>
                    <span style={{ color: '#fecaca' }}>{detail.incoisSilence} silence</span>
                  </div>
                  <span style={{ color: '#94a3b8', fontSize: '8px' }}>Last Packet: {detail.incoisLastEpoch}</span>
                </div>
              </div>

              {/* View on Globe Action */}
              {onSelectBuoy && (
                <button
                  onClick={() => onSelectBuoy(buoy)}
                  style={{
                    alignSelf: 'flex-start',
                    marginTop: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    background: isLost ? 'rgba(244, 63, 94, 0.12)' : 'rgba(234, 179, 8, 0.12)',
                    border: isLost ? '1px solid rgba(244, 63, 94, 0.35)' : '1px solid rgba(234, 179, 8, 0.35)',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    color: isLost ? '#fca5a5' : '#fef08a',
                    fontSize: '9px',
                    fontFamily: 'monospace',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = isLost ? 'rgba(244, 63, 94, 0.28)' : 'rgba(234, 179, 8, 0.28)';
                    e.currentTarget.style.borderColor = isLost ? '#f43f5e' : '#eab308';
                    e.currentTarget.style.color = '#ffffff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isLost ? 'rgba(244, 63, 94, 0.12)' : 'rgba(234, 179, 8, 0.12)';
                    e.currentTarget.style.borderColor = isLost ? 'rgba(244, 63, 94, 0.35)' : 'rgba(234, 179, 8, 0.35)';
                    e.currentTarget.style.color = isLost ? '#fca5a5' : '#fef08a';
                  }}
                >
                  <Compass size={11} color={isLost ? '#f43f5e' : '#eab308'} />
                  <span>VIEW LAST KNOWN LOCATION ON GLOBE</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer Info */}
      <div
        style={{
          padding: '10px 18px',
          background: 'rgba(2, 6, 23, 0.65)',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '9px',
          color: '#64748b',
          fontFamily: 'monospace',
        }}
      >
        <span>NIOT / INCOIS MOORING LIFECYCLE REGISTRY</span>
        <span style={{ color: '#fb7185' }}>3 ARCHIVED STATIONS</span>
      </div>
    </div>
  );
}
