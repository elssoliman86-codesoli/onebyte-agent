import React from 'react';
import CyberSecurityScreen from './hunter';

/**
 * Backwards-compatible route alias.
 * The drawer's Cybersecurity Lab entry historically pointed at /lab,
 * which rendered the Developer Studio welcome screen by mistake.
 * Keep the route stable, but render the real authorized security workspace.
 */
export default function LabScreen() {
  return <CyberSecurityScreen />;
}
