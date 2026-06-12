import { createClient } from '@supabase/supabase-js';
import { DATA, type TournamentData, type GroupStageMatch, type KnockoutMatch, type Venue } from './data';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function supabaseConfigured(): boolean {
  return !!(supabaseUrl && supabaseKey);
}

export async function loadTournamentData(): Promise<{ data: TournamentData; source: 'db' | 'static' }> {
  if (!supabaseConfigured()) return { data: DATA, source: 'static' };

  try {
    const sb = createClient(supabaseUrl!, supabaseKey!);

    const [venueRes, groupRes, groupTeamRes, teamRes, matchRes] = await Promise.all([
      sb.from('venues').select('*'),
      sb.from('groups').select('*'),
      sb.from('group_teams').select('group_letter, position, team_id, teams(name)').order('position'),
      sb.from('teams').select('*'),
      sb.from('matches').select('*, home_team:teams!home_team_id(name), away_team:teams!away_team_id(name)').order('match_number'),
    ]);

    if (venueRes.error || groupRes.error || groupTeamRes.error || teamRes.error || matchRes.error) {
      console.error('Supabase query error, falling back to static data');
      return { data: DATA, source: 'static' };
    }

    const venues: Record<string, Venue> = {};
    for (const v of venueRes.data) {
      venues[v.code] = { common: v.common_name, fifa: v.fifa_name, city: v.city, country: v.country, cap: v.capacity };
    }

    const teamById: Record<number, { name: string; flag: string; is_host: boolean }> = {};
    for (const t of teamRes.data) {
      teamById[t.id] = { name: t.name, flag: t.flag, is_host: t.is_host };
    }

    const flags: Record<string, string> = {};
    for (const t of teamRes.data) flags[t.name] = t.flag;

    const hosts = teamRes.data.filter((t: { is_host: boolean }) => t.is_host).map((t: { name: string }) => t.name);

    const groups: Record<string, string[]> = {};
    const gcolor: Record<string, string> = {};
    for (const g of groupRes.data) gcolor[g.letter] = g.color;
    for (const gt of groupTeamRes.data) {
      const letter = gt.group_letter;
      if (!groups[letter]) groups[letter] = [];
      const team = gt.teams as unknown as { name: string };
      groups[letter].push(team.name);
    }

    const gs: GroupStageMatch[] = [];
    const ko: KnockoutMatch[] = [];
    const starts: number[] = [];

    for (const m of matchRes.data) {
      const ts = new Date(m.kickoff_utc).getTime();
      starts.push(ts);

      if (m.stage === 'group') {
        const home = m.home_team as unknown as { name: string } | null;
        const away = m.away_team as unknown as { name: string } | null;
        gs.push({
          no: m.match_number,
          iso: m.iso_date,
          local: m.local_time,
          et: m.et_time,
          g: m.group_letter,
          t1: home?.name || 'TBD',
          t2: away?.name || 'TBD',
          v: m.venue_code,
          ts,
        });
      } else {
        ko.push({
          round: m.round || '',
          mr: m.match_range || '',
          iso: m.iso_date,
          local: m.local_time,
          et: m.et_time,
          v: m.venue_code,
          ts,
        });
      }
    }

    return {
      data: { venues, groups, hosts, gs, ko, flags, gcolor, starts },
      source: 'db',
    };
  } catch (err) {
    console.error('Failed to load from Supabase:', err);
    return { data: DATA, source: 'static' };
  }
}
