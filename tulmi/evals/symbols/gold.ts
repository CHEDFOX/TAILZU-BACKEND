/**
 * HAND-WRITTEN GOLD FOR SYMBOL READING: ONE REALISTIC FILE PER LANGUAGE, AND THE DEFINITIONS A GOOD INDEX LISTS FOR IT.
 *
 * Written from what each language means, not from what any reader printed. Each file has the things regexes find hard (decorators and annotations,
 * a signature over several lines, a nested class, an overload, a name that looks like code inside a string or a comment) beside the plain ones.
 *
 * What counts as a definition (the contract, the same for every language):
 *   - a top-level function, class, interface/trait/protocol, enum, struct, type alias, module/namespace, and constant
 *   - a method of a class-like thing, named `Owner.method` (not constructors, not fields, not lambdas)
 *   - nothing local to a function body, nothing that is only in a comment or a string
 *   exported: true when it is visible from outside the file (`export`, `pub`, a capital in Go, `public`, no leading underscore in Python and Dart...)
 *
 * The kinds are compared as classes: function and component are one, struct and class are one, trait and interface are one.
 */

export type GoldDef = readonly [name: string, kind: string, exported: boolean];

export interface Gold {
  lang: string;
  /** The language name lang.ts uses. */
  langName: string;
  path: string;
  code: string;
  defs: readonly GoldDef[];
  /** "GET /x" */
  routes?: readonly string[];
  /** Module specifiers as written. */
  imports?: readonly string[];
}

const TS = `import { a, b as c } from "./util.js";
import type { Config } from './config';
import * as path from "node:path";
const lazy = () => import("./lazy.js");

/** Mentions function fake() {} and class Fake {} in a comment. */
const NOTE = "function inString() {} class InString {}";

export interface Options { name: string; retries?: number }
export type Handler = (req: Request) => Promise<Response>;
type Internal = { id: number };
export enum Level { Debug, Info }

export function parse(
  input: string,
  options: Options = { name: "x" },
): Config {
  function helper() { return 1; }
  return { helper } as unknown as Config;
}

export async function* stream(n: number) { yield n; }
function privateHelper(x: number): number { return x * 2; }

export function over(a: string): string;
export function over(a: number): number;
export function over(a: any): any { return a; }

@Injectable()
export class Service<T> extends Base implements Handler {
  private cache = new Map<string, T>();
  static create(): Service<unknown> { return new Service(); }
  async run(job: Job): Promise<void> { await job.go(); }
  get size(): number { return this.cache.size; }
  handle = (req: Request) => this.run(req as never);
  private secret(): void {}
  constructor(private readonly deps: Deps) { super(); }
}

abstract class Shape { abstract area(): number; describe() { return "shape"; } }
export const VERSION = "1.2.3";
export const double = (n: number) => n * 2;
export const memoised = memo(function Inner() { return null; });
const hidden = 5;
export default class Main {}
export { privateHelper as exposed };

export namespace Utils {
  export function pad(s: string) { return s; }
  export const SEP = ",";
}

app.get("/users/:id", requireAuth, async (req, res) => { res.json({}); });
router.post("/users", validate, create);
axios.get("/remote");
`;

const TSX = `import React, { memo } from "react";
import { Button } from "./Button";

type Props = { label: string };

export function Page({ label }: Props) {
  return (
    <div className="page" title="Page title">
      <h1>Welcome back</h1>
      <Button placeholder="Your name" onClick={() => go()}>Sign up</Button>
      {"Literal child"}
    </div>
  );
}

export const Card = memo(function Card(props: Props) { return <section>{props.label}</section>; });
export const Footer = () => <footer aria-label="Site footer">All rights reserved</footer>;
function useThing() { return 1; }
export default Page;
`;

const PY = `import os, sys
from . import sibling
from ..pkg.mod import (a,
    b as bee)
import numpy as np

MAX_RETRIES = 3
_hidden = 4
timeout = 10

def public_func(x: int,
                y: int = 2) -> int:
    def inner():
        return x
    return inner() + y

def _private_func():
    pass

async def fetch(url):
    return url

@app.get("/users/{user_id}")
async def get_user(user_id: int):
    return {}

@router.route("/submit", methods=["POST", "PUT"])
def submit():
    pass

class Base(object):
    LIMIT = 10
    def __init__(self, name):
        self.name = name

    @property
    def title(self):
        return self.name

    @staticmethod
    def build():
        return Base("x")

    def _internal(self):
        pass

    class Meta:
        def describe(self):
            return "meta"

class _Hidden:
    pass

if __name__ == "__main__":
    public_func(1)
`;

const GO = `package main

import (
	"fmt"
	str "strings"
	_ "embed"
)

import "net/http"

const MaxItems = 100
const internalLimit = 5

var (
	Version = "1.0"
	debug   bool
)

type User struct {
	Name string
}

type Store interface {
	Get(id string) (*User, error)
}

type ID int
type unexported struct{}

func main() {
	http.HandleFunc("/health", health)
	r.GET("/users/:id", getUser)
	mux.Handle("POST /orders", orderHandler)
}

func NewUser(
	name string,
	age int,
) *User {
	type local struct{}
	const localConst = 1
	return &User{Name: name}
}

func (u *User) Save() error { return nil }
func (s memStore[T]) Lookup(id string) (T, bool) { var zero T; return zero, false }
func helper() {}
`;

const RS = `use std::collections::HashMap;
mod util;
pub mod net;

pub const MAX: usize = 10;
const LOCAL: usize = 1;
pub static GLOBAL: &str = "g";

pub struct Config { pub name: String }
struct Private;
pub enum Mode { Fast, Slow }
pub trait Runner {
    fn run(&self);
    fn stop(&self) {}
}
pub type Result<T> = std::result::Result<T, Error>;

impl Config {
    pub fn new(name: String) -> Self { Config { name } }
    fn validate(&self) -> bool { true }
}

impl Runner for Config {
    fn run(&self) {}
}

pub fn build<T>(
    input: T,
) -> Config where T: Into<String> {
    fn nested() {}
    Config::new(input.into())
}

fn private_fn() {}

#[get("/users/{id}")]
async fn get_user() {}

fn main() {
    let app = Router::new().route("/health", get(health));
}
`;

const JAVA = `package com.acme.shop;

import com.acme.util.Strings;
import static com.acme.util.Maths.max;
import java.util.*;

@RestController
@RequestMapping("/api")
public class OrderController extends BaseController implements Auditable {
    private final OrderService service;
    public static final int LIMIT = 10;

    @GetMapping("/orders/{id}")
    public Order get(@PathVariable long id) {
        Runnable r = new Runnable() { public void run() {} };
        return service.find(id);
    }

    @PostMapping("/orders")
    public Order create(
        @RequestBody OrderRequest request,
        Principal principal
    ) { return null; }

    private void audit() {}
    static void helper() {}

    public enum Status { OPEN, CLOSED }
    public interface Listener { void onEvent(String e); }
    public static class Builder { public Builder withId(long id) { return this; } }

    public static void main(String[] args) {}
}

interface Auditable { void audit(); }
enum Color { RED, GREEN }
record Point(int x, int y) {}
`;

const KT = `package com.acme.app

import com.acme.util.Strings
import kotlin.collections.*

const val MAX = 5
private const val SECRET = "s"

interface Repo { fun find(id: Long): User? }

data class User(val id: Long, val name: String) {
    fun greet(): String = "hi $name"
    private fun hidden() {}
}

object Registry {
    fun register(u: User) {}
}

enum class Color { RED, GREEN }

class Service(private val repo: Repo) : Base() {
    suspend fun load(
        id: Long,
    ): User? = repo.find(id)

    companion object { fun create() = Service(DefaultRepo()) }
}

fun top(a: Int): Int {
    fun local() = a
    return local()
}

private fun internalHelper() {}

typealias Names = List<String>

fun main() { println("hi") }
`;

const RB = `require_relative 'lib/helper'
require 'json'

module Billing
  VERSION = "1.0"
  TAX_RATE = 0.2

  class Invoice < Base
    MAX_ITEMS = 10

    def initialize(items)
      @items = items
    end

    def total
      @items.sum
    end

    def self.build(items)
      new(items)
    end

    private

    def apply_tax
      total * TAX_RATE
    end
  end

  module Helpers
    def format_money(n)
      n.to_s
    end
  end
end

def top_level_helper
  1
end

get '/health' do
  "ok"
end
`;

const PHP = `<?php
namespace App\\Http;

use App\\Models\\User;
require_once 'helpers.php';

interface Repository { public function find($id); }
trait Loggable { public function log($m) {} }
enum Status { case Active; case Off; }

const VERSION = "1";

abstract class Controller extends Base implements Repository {
    const LIMIT = 10;
    public function index() { return view('home'); }
    protected function guard() {}
    private static function secret() {}
    public static function make(
        array $options,
        $flag = false
    ) { return new static(); }
}

function helper($a) {
    $f = function () { return 1; };
    return strlen($a);
}

Route::get('/users', [UserController::class, 'index']);
Route::post('/users', 'UserController@store');
`;

const SWIFT = `import Foundation
import SwiftUI

public protocol Greeter { func greet() -> String }

@main
struct App: App {
    var body: some Scene { WindowGroup { ContentView() } }
}

struct ContentView: View {
    @State private var count = 0
    var body: some View { Text("Hello") }
    func increment() { count += 1 }
    private func reset() {}
}

public class Service: Base {
    public func run() {}
    func internalRun() {}
    private func hidden() {}
}

enum Kind { case a, b }
extension Service { func extra() {} }
typealias ID = Int
func topLevel(_ x: Int) -> Int { return x }
fileprivate func local() {}
let globalCount = 5
`;

const CS = `using System;
using System.Collections.Generic;

namespace Acme.Shop
{
    public interface IRepo { void Save(); }
    public record Person(string Name);
    public struct Point { public int X; }
    public enum Kind { A, B }

    [ApiController]
    [Route("api/users")]
    public class UsersController : ControllerBase
    {
        private int count;

        [HttpGet("{id}")]
        public async Task<User> Get(int id)
        {
            return await svc.Find(id);
        }

        [HttpPost]
        public IActionResult Create(
            [FromBody] UserDto dto,
            CancellationToken ct) { return Ok(); }

        internal void Hidden() {}
        private static int Counter() { return 1; }
        public static void Main(string[] args) {}
    }

    internal class Helper { public void Run() {} }
}
`;

const DART = `import 'package:flutter/material.dart';
import 'src/util.dart';
export 'other.dart';

const kMax = 5;
final _cache = <String, int>{};

class Home extends StatelessWidget {
  const Home({super.key});

  @override
  Widget build(BuildContext context) {
    return Text('Hello');
  }

  void _hidden() {}
  static int count() => 1;
}

mixin Loud on Base { void shout() {} }
enum Color { red, green }
extension StringX on String { String shout() => toUpperCase(); }
typedef Callback = void Function(int);

abstract class Repo {
  Future<User> find(int id);
}

Future<void> main() async {
  runApp(const Home());
}

int add(int a, int b) => a + b;
String _internal() => '';
`;

export const GOLD: readonly Gold[] = [
  {
    lang: "typescript", langName: "TypeScript", path: "service.ts", code: TS,
    defs: [
      ["NOTE", "const", false], ["Options", "interface", true], ["Handler", "type", true], ["Internal", "type", false], ["Level", "enum", true],
      ["parse", "function", true], ["stream", "function", true], ["privateHelper", "function", false],
      ["over", "function", true], ["over", "function", true], ["over", "function", true], ["Service", "class", true], ["Service.create", "method", true], ["Service.run", "method", true], ["Service.size", "method", true],
      ["Service.handle", "method", true], ["Service.secret", "method", false],
      ["Shape", "class", false], ["Shape.describe", "method", false], ["Shape.area", "method", false],
      ["VERSION", "const", true], ["double", "function", true], ["memoised", "const", true], ["hidden", "const", false], ["lazy", "function", false],
      ["Main", "class", true], ["exposed", "function", true], ["Utils", "module", true], ["pad", "function", true], ["SEP", "const", true],
    ],
    routes: ["GET /users/:id", "POST /users"],
    imports: ["./util.js", "./config", "node:path", "./lazy.js"],
  },
  {
    lang: "tsx", langName: "TypeScript", path: "Page.tsx", code: TSX,
    defs: [["Page", "function", true], ["Props", "type", false], ["Card", "function", true], ["Footer", "function", true], ["useThing", "function", false], ["default", "const", true]],
    imports: ["react", "./Button"],
  },
  {
    lang: "python", langName: "Python", path: "app.py", code: PY,
    defs: [
      ["MAX_RETRIES", "const", true], ["public_func", "function", true], ["_private_func", "function", false], ["fetch", "function", true],
      ["get_user", "function", true], ["submit", "function", true], ["Base", "class", true], ["Base.__init__", "method", false], ["Base.title", "method", true],
      ["Base.build", "method", true], ["Base._internal", "method", false], ["Meta", "class", true], ["Meta.describe", "method", true], ["_Hidden", "class", false],
    ],
    routes: ["GET /users/{user_id}", "POST|PUT /submit"],
    imports: ["os", "sys", ".", "..pkg.mod", "numpy"],
  },
  {
    lang: "go", langName: "Go", path: "main.go", code: GO,
    defs: [
      ["MaxItems", "const", true], ["internalLimit", "const", false], ["Version", "const", true], ["debug", "const", false],
      ["User", "class", true], ["Store", "interface", true], ["ID", "type", true], ["unexported", "class", false],
      ["main", "function", false], ["NewUser", "function", true], ["User.Save", "method", true], ["memStore.Lookup", "method", true], ["helper", "function", false],
    ],
    routes: ["ANY /health", "GET /users/:id", "POST /orders"],
    imports: ["fmt", "strings", "embed", "net/http"],
  },
  {
    lang: "rust", langName: "Rust", path: "lib.rs", code: RS,
    defs: [
      ["util", "module", false], ["net", "module", true], ["MAX", "const", true], ["LOCAL", "const", false], ["GLOBAL", "const", true],
      ["Config", "class", true], ["Private", "class", false], ["Mode", "enum", true], ["Runner", "interface", true], ["Runner.run", "method", true], ["Runner.stop", "method", true],
      ["Result", "type", true], ["Config.new", "method", true], ["Config.validate", "method", false], ["Config.run", "method", true],
      ["build", "function", true], ["private_fn", "function", false], ["get_user", "function", false], ["main", "function", false],
    ],
    routes: ["GET /users/{id}", "GET /health"],
    imports: ["util", "net"],
  },
  {
    lang: "java", langName: "Java", path: "OrderController.java", code: JAVA,
    defs: [
      ["OrderController", "class", true], ["OrderController.get", "method", true], ["OrderController.create", "method", true], ["OrderController.audit", "method", false],
      ["OrderController.helper", "method", false], ["Status", "enum", true], ["Listener", "interface", true], ["Listener.onEvent", "method", true], ["Builder", "class", true],
      ["Builder.withId", "method", true], ["OrderController.main", "method", true], ["Auditable", "interface", false], ["Auditable.audit", "method", true],
      ["Color", "enum", false], ["Point", "class", false],
    ],
    routes: ["GET /api/orders/{id}", "POST /api/orders"],
    imports: ["com.acme.util.Strings", "com.acme.util.Maths.max", "java.util"],
  },
  {
    lang: "kotlin", langName: "Kotlin", path: "App.kt", code: KT,
    defs: [
      ["MAX", "const", true], ["SECRET", "const", false], ["Repo", "interface", true], ["Repo.find", "method", true], ["User", "class", true], ["User.greet", "method", true], ["User.hidden", "method", false],
      ["Registry", "class", true], ["Registry.register", "method", true], ["Color", "enum", true], ["Service", "class", true], ["Service.load", "method", true],
      ["Service.create", "method", true], ["top", "function", true], ["internalHelper", "function", false], ["Names", "type", true], ["main", "function", true],
    ],
    imports: ["com.acme.util.Strings", "kotlin.collections"],
  },
  {
    lang: "ruby", langName: "Ruby", path: "billing.rb", code: RB,
    defs: [
      ["Billing", "module", true], ["VERSION", "const", true], ["TAX_RATE", "const", true], ["Invoice", "class", true], ["MAX_ITEMS", "const", true],
      ["Invoice.initialize", "method", true], ["Invoice.total", "method", true], ["Invoice.build", "method", true], ["Invoice.apply_tax", "method", false],
      ["Helpers", "module", true], ["Helpers.format_money", "method", true], ["top_level_helper", "function", true],
    ],
    routes: ["GET /health"],
    imports: ["lib/helper"],
  },
  {
    lang: "php", langName: "PHP", path: "Controller.php", code: PHP,
    defs: [
      ["Repository", "interface", true], ["Repository.find", "method", true], ["Loggable", "interface", true], ["Loggable.log", "method", true], ["Status", "enum", true], ["VERSION", "const", true],
      ["Controller", "class", true], ["Controller.index", "method", true], ["Controller.guard", "method", false], ["Controller.secret", "method", false], ["Controller.make", "method", true],
      ["helper", "function", true],
    ],
    routes: ["GET /users", "POST /users"],
    imports: ["helpers.php"],
  },
  {
    lang: "swift", langName: "Swift", path: "App.swift", code: SWIFT,
    defs: [
      ["Greeter", "interface", true], ["Greeter.greet", "method", true], ["App", "class", true], ["ContentView", "class", true], ["ContentView.increment", "method", true], ["ContentView.reset", "method", false],
      ["Service", "class", true], ["Service.run", "method", true], ["Service.internalRun", "method", true], ["Service.hidden", "method", false],
      ["Kind", "enum", true], ["Service.extra", "method", true], ["ID", "type", true], ["topLevel", "function", true], ["local", "function", false], ["globalCount", "const", true],
    ],
  },
  {
    lang: "c_sharp", langName: "C#", path: "UsersController.cs", code: CS,
    defs: [
      ["Acme.Shop", "module", true], ["IRepo", "interface", true], ["IRepo.Save", "method", true], ["Person", "class", true], ["Point", "class", true], ["Kind", "enum", true],
      ["UsersController", "class", true], ["UsersController.Get", "method", true], ["UsersController.Create", "method", true], ["UsersController.Hidden", "method", false],
      ["UsersController.Counter", "method", false], ["UsersController.Main", "method", true], ["Helper", "class", true], ["Helper.Run", "method", true],
    ],
    routes: ["GET /api/users/{id}", "POST /api/users"],
  },
  {
    lang: "dart", langName: "Dart", path: "home.dart", code: DART,
    defs: [
      ["kMax", "const", true], ["_cache", "const", false], ["Home", "class", true], ["Home.build", "method", true], ["Home._hidden", "method", false], ["Home.count", "method", true],
      ["Loud", "class", true], ["Loud.shout", "method", true], ["Color", "enum", true], ["StringX", "class", true], ["StringX.shout", "method", true], ["Callback", "type", true],
      ["Repo", "class", true], ["Repo.find", "method", true], ["main", "function", true], ["add", "function", true], ["_internal", "function", false],
    ],
    imports: ["package:flutter/material.dart", "src/util.dart", "other.dart"],
  },
];
