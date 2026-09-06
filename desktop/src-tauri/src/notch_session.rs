//! Session tokens prevent late blur/save timers from closing a newly opened panel.
#[derive(Clone, Copy, Default, PartialEq, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Hidden,
    Preview,
    Editing,
}

#[derive(Default)]
pub struct Session {
    pub id: u64,
    pub mode: Mode,
    pub busy: bool,
}
impl Session {
    pub fn open(&mut self, mode: Mode) {
        self.id += 1;
        self.mode = mode;
        self.busy = false;
    }
    pub fn accepts(&self, id: u64) -> bool {
        self.id == id && self.mode != Mode::Hidden
    }
    pub fn close(&mut self, id: u64) -> bool {
        if !self.accepts(id) {
            return false;
        }
        self.mode = Mode::Hidden;
        self.busy = false;
        true
    }
    pub fn can_blur_close(&self, id: u64) -> bool {
        self.accepts(id) && self.mode == Mode::Editing && !self.busy
    }
    pub fn mouse_may_close(&self) -> bool {
        self.mode == Mode::Preview
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_close_does_not_affect_reopened_panel() {
        let mut s = Session::default();
        s.open(Mode::Editing);
        let old = s.id;
        assert!(s.close(old));
        s.open(Mode::Editing);
        assert!(!s.close(old));
        assert!(!s.can_blur_close(old));
        assert_eq!(s.mode, Mode::Editing);
    }
    #[test]
    fn editing_and_saving_ignore_mouse_absence() {
        let mut s = Session::default();
        s.open(Mode::Preview);
        assert!(s.mouse_may_close());
        s.mode = Mode::Editing;
        assert!(!s.mouse_may_close());
        s.busy = true;
        assert!(!s.can_blur_close(s.id));
        s.busy = false;
        assert!(s.can_blur_close(s.id));
    }
}
