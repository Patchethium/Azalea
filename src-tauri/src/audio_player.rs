use rodio::{OutputStream, Sink, Source};
use std::error::Error;

struct SampleSource {
    // Store raw bytes
    samples: Vec<u8>,
    position: usize,
}

impl Source for SampleSource {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        1
    }

    fn sample_rate(&self) -> u32 {
        24000
    }

    fn total_duration(&self) -> Option<std::time::Duration> {
        Some(std::time::Duration::from_secs_f32(
            (self.samples.len() / 2) as f32 / self.sample_rate() as f32
        ))
    }
}

impl Iterator for SampleSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.position + 1 >= self.samples.len() {
            None
        } else {
            // Convert two bytes to i16, then to f32
            let sample_bytes = [self.samples[self.position], self.samples[self.position + 1]];
            let sample_i16 = i16::from_le_bytes(sample_bytes);
            let sample_f32 = sample_i16 as f32 / 32768.0; // Convert to -1.0 to 1.0 range
            
            self.position += 2;
            Some(sample_f32)
        }
    }
}

pub fn play_samples(samples: Vec<u8>) -> Result<(), Box<dyn Error>> {
    let (_stream, stream_handle) = OutputStream::try_default()?;
    let sink = Sink::try_new(&stream_handle)?;
    
    let source = SampleSource {
        samples,
        position: 0,
    };
    
    sink.append(source);
    sink.sleep_until_end();
    
    Ok(())
}

// Optional: Add a non-blocking version
// usage: play_samples_async(samples).unwrap().sleep_until_end();
pub fn play_samples_async(samples: Vec<u8>) -> Result<Sink, Box<dyn Error>> {
    let (_stream, stream_handle) = OutputStream::try_default()?;
    let sink = Sink::try_new(&stream_handle)?;
    
    let source = SampleSource {
        samples,
        position: 0,
    };
    
    sink.append(source);
    Ok(sink)
}