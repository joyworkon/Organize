//! Screen geometry is always in AppKit global points, never per-screen pixels.
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn valid(self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite())
            && self.width > 0.0
            && self.height > 0.0
    }
    pub fn right(self) -> f64 {
        self.x + self.width
    }
    pub fn top(self) -> f64 {
        self.y + self.height
    }
    pub fn contains(self, x: f64, y: f64) -> bool {
        self.valid() && x >= self.x && x < self.right() && y >= self.y && y < self.top()
    }
    pub fn intersect(self, other: Self) -> Option<Self> {
        let x = self.x.max(other.x);
        let y = self.y.max(other.y);
        let r = Self {
            x,
            y,
            width: self.right().min(other.right()) - x,
            height: self.top().min(other.top()) - y,
        };
        r.valid().then_some(r)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Screen {
    pub id: u32,
    pub frame: Rect,
    pub usable: Rect,
    pub notch: Option<Rect>,
    pub scale: f64,
}

/// Both auxiliary rectangles must describe a real gap; otherwise use ordinary UI.
pub fn camera_gap(frame: Rect, top: f64, left: Rect, right: Rect) -> Option<Rect> {
    if !frame.valid()
        || !top.is_finite()
        || top <= 0.0
        || top >= frame.height
        || !left.valid()
        || !right.valid()
    {
        return None;
    }
    let gap = Rect {
        x: left.right(),
        y: frame.top() - top,
        width: right.x - left.right(),
        height: top,
    };
    (gap.valid()
        && gap.x >= frame.x
        && gap.right() <= frame.right()
        && left.top() >= frame.top() - 1.0
        && right.top() >= frame.top() - 1.0)
        .then_some(gap)
}

pub fn usable_area(frame: Rect, visible: Rect, top: f64) -> Option<Rect> {
    if !frame.valid() || !visible.valid() {
        return None;
    }
    let top = if top.is_finite() {
        top.clamp(0.0, frame.height)
    } else {
        0.0
    };
    frame.intersect(visible)?.intersect(Rect {
        height: frame.height - top,
        ..frame
    })
}

pub fn panel_frame(screen: &Screen) -> Option<Rect> {
    let u = screen.usable;
    // Below this the capture UI is unusable; main-window/menu fallback remains available.
    if !u.valid() || u.width < 240.0 || u.height < 240.0 {
        return None;
    }
    let width = 380.0_f64.min(u.width - 16.0);
    let height = 520.0_f64.min(u.height - 16.0);
    let center = screen
        .notch
        .map(|r| r.x + r.width / 2.0)
        .unwrap_or(screen.frame.x + screen.frame.width / 2.0);
    Some(Rect {
        x: (center - width / 2.0).clamp(u.x + 8.0, u.right() - width - 8.0),
        y: u.top() - height - 8.0,
        width,
        height,
    })
}

/// A visible strip below the menu/camera area, not an invisible camera-sized hotspot.
pub fn trigger_frame(screen: &Screen, plain_displays: bool) -> Option<Rect> {
    if screen.notch.is_none() && !plain_displays {
        return None;
    }
    let u = screen.usable;
    if !u.valid() || u.width < 240.0 || u.height < 240.0 {
        return None;
    }
    let width = screen
        .notch
        .map(|r| r.width)
        .unwrap_or(96.0)
        .clamp(80.0, 220.0)
        .min(u.width - 16.0);
    let center = screen
        .notch
        .map(|r| r.x + r.width / 2.0)
        .unwrap_or(screen.frame.x + screen.frame.width / 2.0);
    Some(Rect {
        x: (center - width / 2.0).clamp(u.x + 8.0, u.right() - width - 8.0),
        y: u.top() - 8.0,
        width,
        height: 6.0,
    })
}

pub fn target_screen(
    screens: &[Screen],
    requested: Option<u32>,
    cursor: (f64, f64),
) -> Option<&Screen> {
    requested
        .and_then(|id| screens.iter().find(|s| s.id == id))
        .or_else(|| {
            screens
                .iter()
                .find(|s| s.frame.contains(cursor.0, cursor.1))
        })
        .or_else(|| screens.first())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn screen(id: u32, x: f64, y: f64, width: f64, height: f64, scale: f64) -> Screen {
        let frame = Rect {
            x,
            y,
            width,
            height,
        };
        Screen {
            id,
            frame,
            usable: Rect {
                height: height - 32.0,
                ..frame
            },
            notch: None,
            scale,
        }
    }
    #[test]
    fn mixed_scales_do_not_change_hit_testing_or_layout() {
        let mut external = screen(2, 1440.0, -200.0, 1920.0, 1080.0, 1.0);
        let a = panel_frame(&external).unwrap();
        external.scale = 2.0;
        assert_eq!(panel_frame(&external).unwrap(), a);
        assert!(a.contains(a.x + 10.0, a.y + 10.0));
    }
    #[test]
    fn notch_is_per_screen_and_uses_actual_auxiliary_gap() {
        let f = Rect {
            x: -1512.0,
            y: 800.0,
            width: 1512.0,
            height: 982.0,
        };
        let l = Rect {
            x: -1512.0,
            y: 1744.0,
            width: 650.0,
            height: 38.0,
        };
        let r = Rect { x: -650.0, ..l };
        let gap = camera_gap(f, 38.0, l, r).unwrap();
        assert_eq!(gap.width, 212.0);
        assert_eq!(gap.y, 1744.0);
        assert!(camera_gap(f, 0.0, l, r).is_none());
        assert!(camera_gap(f, 38.0, Rect::default(), r).is_none());
    }
    #[test]
    fn panel_fits_small_work_area_with_dock_on_left() {
        let mut s = screen(1, 0.0, 0.0, 600.0, 450.0, 2.0);
        s.usable = Rect {
            x: 100.0,
            y: 0.0,
            width: 500.0,
            height: 390.0,
        };
        let p = panel_frame(&s).unwrap();
        assert!(p.x >= 108.0 && p.right() <= 592.0);
        assert!(p.y >= 8.0 && p.top() <= 382.0);
        assert_eq!(p.height, 374.0);
    }
    #[test]
    fn removed_target_falls_back_to_pointer_then_primary() {
        let a = screen(10, 0.0, 0.0, 1440.0, 900.0, 2.0);
        let b = screen(20, 0.0, 900.0, 1920.0, 1080.0, 1.0);
        assert_eq!(
            target_screen(&[a.clone(), b], Some(99), (100.0, 1100.0))
                .unwrap()
                .id,
            20
        );
        assert_eq!(
            target_screen(&[a], Some(99), (-9000.0, 0.0)).unwrap().id,
            10
        );
        assert!(target_screen(&[], None, (0.0, 0.0)).is_none());
    }
    #[test]
    fn plain_display_handles_are_opt_in_and_never_in_menu_bar() {
        let s = screen(1, 0.0, 0.0, 1440.0, 900.0, 2.0);
        assert!(trigger_frame(&s, false).is_none());
        let t = trigger_frame(&s, true).unwrap();
        assert!(t.top() <= s.usable.top());
        assert_eq!(t.height, 6.0);
    }
    #[test]
    fn invalid_geometry_is_rejected_and_insets_are_not_doubled() {
        let f = Rect {
            x: 0.0,
            y: 0.0,
            width: 1000.0,
            height: 800.0,
        };
        let v = Rect { height: 762.0, ..f };
        assert_eq!(usable_area(f, v, 38.0).unwrap().height, 762.0);
        assert!(usable_area(f, v, 800.0).is_none());
        assert!(!Rect { x: f64::NAN, ..f }.valid());
    }
}
