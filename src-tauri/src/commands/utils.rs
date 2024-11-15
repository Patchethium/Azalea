/// macro to do the lock().unwrap().as_ref().ok_or("Not initialized")? dance
#[allow(unused_macros)]
macro_rules! state_ref {
  ($state:expr, $field:ident) => {
    $state
      .$field
      .read()
      .unwrap()
      .as_ref()
      .ok_or(concat!(stringify!($field), " is not initialized"))?
  };
}

#[allow(unused_macros)]
macro_rules! state_mut {
  ($state:expr, $field:ident) => {
    $state.$field.write().unwrap()
  };
}

pub(crate) use state_mut;
pub(crate) use state_ref;
