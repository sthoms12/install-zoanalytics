use anyhow::{Context, Result};
use std::env;
use webgraph::graphs::bvgraph::BvGraph;
use webgraph::traits::RandomAccessGraph;

fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    let basename = args.next().context("missing graph basename")?;
    let nodes = args
        .map(|value| value.parse::<usize>().context("invalid node id"))
        .collect::<Result<Vec<_>>>()?;
    let graph = BvGraph::with_basename(basename).load()?;
    for node in nodes {
        for source in graph.successors(node) {
            println!("{node}\t{source}");
        }
    }
    Ok(())
}
