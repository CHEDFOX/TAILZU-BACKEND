"""
BPHS Chapter 40 — Dasha Sandhi (Chidra)
Junction periods between dashas — last ~10% of any dasha period is unstable.
Critical for timing predictions. Events during chidra are unpredictable.
Also: first portion of new dasha takes time to activate.
"""
from typing import Dict
from datetime import datetime, timedelta


def calculate_dasha_sandhi(dasha_data: Dict) -> Dict:
    """
    Analyze current dasha periods for sandhi (junction) zones.
    Checks mahadasha, antardasha, and pratyantardasha.
    """
    results = {
        'in_sandhi': False,
        'sandhi_details': [],
        'current_stability': 'stable',
    }

    # Check each level
    for level in ['mahadasha', 'antardasha', 'pratyantardasha']:
        period = dasha_data.get(level, {})
        if not period:
            continue

        start_str = period.get('start_date', '')
        end_str = period.get('end_date', '')
        planet = period.get('planet', '')

        if not start_str or not end_str:
            continue

        try:
            if isinstance(start_str, str):
                start = datetime.strptime(start_str, '%Y-%m-%d')
            else:
                start = start_str
            if isinstance(end_str, str):
                end = datetime.strptime(end_str, '%Y-%m-%d')
            else:
                end = end_str
        except (ValueError, TypeError):
            continue

        now = datetime.now()
        total_days = (end - start).days
        if total_days <= 0:
            continue

        elapsed = (now - start).days
        remaining = (end - now).days

        # Chidra zone = last 10% of period
        chidra_days = max(int(total_days * 0.1), 1)
        # Activation zone = first 5% of period
        activation_days = max(int(total_days * 0.05), 1)

        in_chidra = remaining <= chidra_days and remaining >= 0
        in_activation = elapsed <= activation_days and elapsed >= 0
        progress = round(elapsed / total_days * 100, 1) if total_days > 0 else 0

        if in_chidra:
            chidra_start = end - timedelta(days=chidra_days)
            next_planet = period.get('next_planet', 'Unknown')
            results['sandhi_details'].append({
                'level': level,
                'planet': planet,
                'zone': 'chidra',
                'description': f'{level.title()} of {planet} ending — last {chidra_days} days. Transition to {next_planet} approaching.',
                'remaining_days': remaining,
                'chidra_start': chidra_start.strftime('%Y-%m-%d'),
                'period_end': end.strftime('%Y-%m-%d'),
                'advice': 'Avoid major decisions. Results of this period are concluding. New energy is forming.',
                'severity': 'high' if level == 'mahadasha' else 'medium' if level == 'antardasha' else 'low',
            })
            results['in_sandhi'] = True

        elif in_activation:
            results['sandhi_details'].append({
                'level': level,
                'planet': planet,
                'zone': 'activation',
                'description': f'{level.title()} of {planet} just began — still activating ({activation_days} day settling period).',
                'elapsed_days': elapsed,
                'advice': 'New period energy is forming. Give it time to manifest. Don\'t judge results yet.',
                'severity': 'low',
            })
            results['in_sandhi'] = True

        # Add period info regardless
        if level in ('mahadasha', 'antardasha'):
            results[f'{level}_progress'] = {
                'planet': planet,
                'progress': progress,
                'elapsed_days': elapsed,
                'remaining_days': remaining,
                'total_days': total_days,
                'chidra_zone_starts': (end - timedelta(days=chidra_days)).strftime('%Y-%m-%d'),
                'in_chidra': in_chidra,
                'in_activation': in_activation,
            }

    # Determine overall stability
    if results['in_sandhi']:
        high_severity = any(s.get('severity') == 'high' for s in results['sandhi_details'])
        results['current_stability'] = 'unstable' if high_severity else 'transitioning'
    else:
        results['current_stability'] = 'stable'

    return results

