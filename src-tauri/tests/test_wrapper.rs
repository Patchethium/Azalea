#[cfg(test)]
mod test {
  use azalea_lib::voicevox_sys::wrapper::{self, Wrapper};

  #[test]
  fn test_init_voicevox() {
    let _ = Wrapper::new().unwrap();
  }
  #[test]
  fn test_metas() {
    let wrapper = Wrapper::new().unwrap();
    let metas = wrapper.get_metas().unwrap();
    println!("{:?}", metas[0].styles[0].id);
  }
}
