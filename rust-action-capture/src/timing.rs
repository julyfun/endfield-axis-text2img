//! Keep simulation time separate from packet capture and server wall clocks.
use std::collections::VecDeque;

#[derive(Clone, Copy, Debug)]
pub struct Stamp {
    pub capture_ms: i64,
    pub tick: Option<(usize, i64)>,
}

struct Segment {
    generation: Option<i64>,
    last_tick: i64,
    last_seq: Option<i64>,
    offset_ms: i64,
}

#[derive(Default)]
pub struct Clock {
    segments: Vec<Segment>,
    pings: VecDeque<(i64, i64)>, // (round trip, server minus capture clock)
}

impl Clock {
    pub fn begin(&mut self) {
        self.segments.clear();
    }

    pub fn observe(
        &mut self,
        capture_ms: i64,
        tick: Option<i64>,
        generation: Option<i64>,
        seq: Option<i64>,
    ) -> Stamp {
        let mut stamp = Stamp {
            capture_ms,
            tick: None,
        };
        let Some(tick) = tick.filter(|t| *t > 0) else {
            return stamp;
        };
        // Sequence numbers distinguish a reset from a late, older operation.
        let reset = self.segments.last().is_none_or(|s| {
            generation != s.generation
                || (tick < s.last_tick && seq.zip(s.last_seq).is_none_or(|(a, b)| a > b))
        });
        if reset {
            self.segments.push(Segment {
                generation,
                last_tick: tick,
                last_seq: seq,
                offset_ms: capture_ms - tick,
            });
        }
        let index = self.segments.len() - 1;
        let segment = &mut self.segments[index];
        if tick >= segment.last_tick {
            // The lowest delay anchors the whole segment. A stalled simulation
            // clock must not be advanced by later wall-clock/packet delays.
            segment.offset_ms = segment.offset_ms.min(capture_ms - tick);
            segment.last_tick = tick;
            segment.last_seq = seq;
        }
        stamp.tick = Some((index, tick));
        stamp
    }

    pub fn ping(&mut self, send_ms: i64, receive_ms: i64, server_ms: i64) {
        let rtt = receive_ms - send_ms;
        if !(0..=3000).contains(&rtt) || server_ms <= 0 {
            return;
        }
        self.pings.push_back((rtt, server_ms - send_ms - rtt / 2));
        if self.pings.len() > 32 {
            self.pings.pop_front();
        }
    }

    pub fn server_offset_ms(&self) -> Option<i64> {
        self.pings
            .iter()
            .min_by_key(|(rtt, _)| rtt)
            .map(|(_, offset)| *offset)
    }

    pub fn local_ms(&self, stamp: Stamp) -> i64 {
        stamp
            .tick
            .and_then(|(index, tick)| self.segments.get(index).map(|s| tick + s.offset_ms))
            .unwrap_or(stamp.capture_ms)
    }

    pub fn time_ms(&self, stamp: Stamp, origin: Stamp, end_ms: Option<i64>) -> i64 {
        let local = self.local_ms(stamp);
        end_ms
            .map(|end| end - local - self.server_offset_ms().unwrap_or(0))
            .unwrap_or_else(|| local - self.local_ms(origin))
            .max(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batched_casts_keep_tick_spacing_and_recalibrate_earlier_stamps() {
        let mut clock = Clock::default();
        let origin = clock.observe(10_000, Some(1000), Some(1), Some(1));
        let first = clock.observe(11_000, Some(1200), Some(1), Some(2));
        let second = clock.observe(11_000, Some(1500), Some(1), Some(3));
        assert_eq!(
            clock.time_ms(second, origin, None) - clock.time_ms(first, origin, None),
            300
        );
        // A less delayed subsequent packet improves absolute time for both.
        clock.observe(10_600, Some(1700), Some(1), Some(4));
        assert_eq!(clock.local_ms(first), 10_100);
        assert_eq!(clock.time_ms(first, origin, None), 200);
    }

    #[test]
    fn simulation_pause_does_not_advance_countdown() {
        let mut clock = Clock::default();
        let origin = clock.observe(10_000, Some(1000), Some(1), Some(1));
        let first = clock.observe(11_000, Some(2000), Some(1), Some(2));
        let after_pause = clock.observe(16_100, Some(2100), Some(1), Some(3));
        assert_eq!(clock.time_ms(first, origin, Some(20_000)), 9000);
        assert_eq!(clock.time_ms(after_pause, origin, Some(20_000)), 8900);
    }

    #[test]
    fn lowest_round_trip_corrects_server_clock_and_late_samples() {
        let mut clock = Clock::default();
        let stamp = clock.observe(10_000, None, None, None);
        clock.ping(9000, 9400, 9700); // noisy +500 ms
        clock.ping(9900, 9920, 10210); // best sample: +300 ms
        assert_eq!(clock.time_ms(stamp, stamp, Some(20_000)), 9700);
        clock.ping(11_000, 10_000, 99_000); // invalid sample ignored
        assert_eq!(clock.server_offset_ms(), Some(300));
    }

    #[test]
    fn reset_battle_and_generation_do_not_reuse_stale_tick_anchor() {
        let mut clock = Clock::default();
        clock.ping(1000, 1020, 1010);
        let original = clock.observe(10_000, Some(8000), Some(1), Some(1));
        let late = clock.observe(10_010, Some(7900), Some(1), Some(0));
        assert_eq!(original.tick.unwrap().0, late.tick.unwrap().0);
        let reset = clock.observe(20_000, Some(10), Some(1), Some(2));
        assert_ne!(original.tick.unwrap().0, reset.tick.unwrap().0);
        assert_eq!(clock.local_ms(original), 10_000);
        assert_eq!(clock.local_ms(reset), 20_000);
        let generation = clock.observe(21_000, Some(100), Some(2), Some(1));
        assert_ne!(reset.tick.unwrap().0, generation.tick.unwrap().0);
        clock.begin();
        assert_eq!(clock.server_offset_ms(), Some(0));
        let next = clock.observe(30_000, Some(100), Some(3), Some(1));
        assert_eq!(clock.local_ms(next), 30_000);
    }
}
