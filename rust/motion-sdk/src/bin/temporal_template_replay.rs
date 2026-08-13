use std::env;
use std::fs;
use std::path::Path;

use maxpower_motion_sdk::temporal_template::replay_files;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    let option = |name: &str| -> Result<&str, Box<dyn std::error::Error>> {
        let index = arguments
            .iter()
            .position(|argument| argument == name)
            .ok_or_else(|| format!("missing {name}"))?;
        arguments
            .get(index + 1)
            .map(String::as_str)
            .ok_or_else(|| format!("missing value for {name}").into())
    };
    let dataset = option("--dataset")?;
    let canonical = option("--canonical-sequences")?;
    let model = option("--model")?;
    let output = option("--output")?;
    let report = replay_files(Path::new(dataset), Path::new(canonical), Path::new(model))
        .map_err(|error| format!("temporal replay failed: {error}"))?;
    if let Some(parent) = Path::new(output).parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(
        output,
        format!("{}\n", serde_json::to_string_pretty(&report)?),
    )?;
    println!(
        "{}",
        serde_json::to_string_pretty(&report.same_record.summary)?
    );
    if arguments
        .iter()
        .any(|argument| argument == "--require-golden-exact")
        && !report.golden_exact()
    {
        return Err("personal golden replay did not reach the frozen exact gate".into());
    }
    Ok(())
}
