var assert = require("assert");
var path = require("path");
var Promise = require("nodegit-promise");
var promisify = require("promisify-node");
var fse = promisify("fs-extra");
var local = path.join.bind(path, __dirname);

// Have to wrap exec, since it has a weird callback signature.
var exec = promisify(function(command, opts, callback) {
  return require("child_process").exec(command, opts, callback);
});

describe("Checkout", function() {
  var NodeGit = require("../../");
  var Repository = NodeGit.Repository;
  var Checkout = NodeGit.Checkout;

  var readMeName = "README.md";
  var packageJsonName = "package.json";
  var reposPath = local("../repos/workdir");
  var readMePath = local("../repos/workdir/" + readMeName);
  var packageJsonPath = local("../repos/workdir/" + packageJsonName);
  var checkoutBranchName = "checkout-test";

  beforeEach(function() {
    var test = this;

    return Repository.open(reposPath)
      .then(function(repo) {
        test.repository = repo;
      });
  });

  it.only("lots of files yo", function() {
    var bigRepoPath = local("../repos/bigrepo");
    var url = "https://github.com/kenprice/stress-test-3k";
    var startTime;
    this.timeout(30000);

    return exec("git clone " + url + " " + bigRepoPath)
    .then(function() {
      return Repository.open(bigRepoPath);
    })
    .then(function(repo) {
      for (var i = 0; i < 3000; i++) {
        fse.outputFileSync(bigRepoPath + "/test" + i, "Hello");
      }

      return repo;
    })
    .then(function(repo) {
      console.log("Starting...");
      startTime = new Date();
      var opts = {
        checkoutStrategy: NodeGit.Checkout.STRATEGY.FORCE
      };
      return Checkout.head(repo, opts);
    })
    .then(function(blob) {
      console.log("CHECKOUTDONE[" + (new Date() - startTime)/1000 + "]");
      var fileContent = fse.readFileSync(bigRepoPath + "/test0", "utf8");
      assert.ok(~fileContent.indexOf("Test"));
    });
  });

  it("can checkout the head", function() {
    var test = this;

    return Checkout.head(test.repository)
    .then(function(blob) {
      var packageContent = fse.readFileSync(packageJsonPath, "utf-8");

      assert.ok(~packageContent.indexOf("\"ejs\": \"~1.0.0\","));
    });
  });

  it("can force checkout a single file", function() {
    var test = this;

    var packageContent = fse.readFileSync(packageJsonPath, "utf-8");
    var readmeContent = fse.readFileSync(readMePath, "utf-8");

    assert.notEqual(packageContent, "");
    assert.notEqual(readmeContent, "");

    fse.outputFileSync(readMePath, "");
    fse.outputFileSync(packageJsonPath, "");

    var opts = {
      checkoutStrategy: Checkout.STRATEGY.FORCE,
      paths: packageJsonName
    };

    return Checkout.head(test.repository, opts)
    .then(function() {
      var resetPackageContent = fse.readFileSync(packageJsonPath, "utf-8");
      var resetReadmeContent = fse.readFileSync(readMePath, "utf-8");

      assert.equal(resetPackageContent, packageContent);
      assert.equal(resetReadmeContent, "");

      var resetOpts = {
        checkoutStrategy: Checkout.STRATEGY.FORCE
      };

      return Checkout.head(test.repository, resetOpts);
    }).then(function() {
      var resetContent = fse.readFileSync(readMePath, "utf-8");
      assert.equal(resetContent, readmeContent);
    });
  });

  it("can checkout by tree", function() {
    var test = this;

    return test.repository.getTagByName("annotated-tag").then(function(tag) {
      return Checkout.tree(test.repository, test.tag);
    }).then(function() {
      return test.repository.getHeadCommit();
    }).then(function(commit) {
      assert.equal(commit, "32789a79e71fbc9e04d3eff7425e1771eb595150");
    });
  });

  it("can checkout a branch", function() {
    var test = this;

    return test.repository.checkoutBranch(checkoutBranchName)
    .then(function() {
      var packageContent = fse.readFileSync(packageJsonPath, "utf-8");

      assert.ok(!~packageContent.indexOf("\"ejs\": \"~1.0.0\","));
    })
    .then(function() {
      return test.repository.getStatus();
    })
    .then(function(statuses) {
      assert.equal(statuses.length, 0);
    })
    .then(function() {
      return test.repository.checkoutBranch("master");
    })
    .then(function() {
      var packageContent = fse.readFileSync(packageJsonPath, "utf-8");

      assert.ok(~packageContent.indexOf("\"ejs\": \"~1.0.0\","));
    });
  });

  it("can checkout an index with conflicts", function() {
    var test = this;

    var testBranchName = "test";
    var ourCommit;

    return test.repository.getBranchCommit(checkoutBranchName)
    .then(function(commit) {
      ourCommit = commit;

      return test.repository.createBranch(testBranchName, commit.id());
    })
    .then(function() {
      return test.repository.checkoutBranch(testBranchName);
    })
    .then(function(branch) {
      fse.writeFileSync(packageJsonPath, "\n");

      return test.repository.openIndex()
        .then(function(index) {
          index.read(1);
          index.addByPath(packageJsonName);
          index.write();

          return index.writeTree();
        });
    })
    .then(function(oid) {
      assert.equal(oid.toString(),
        "85135ab398976a4d5be6a8704297a45f2b1e7ab2");

      var signature = test.repository.defaultSignature();

      return test.repository.createCommit("refs/heads/" + testBranchName,
        signature, signature, "we made breaking changes", oid, [ourCommit]);
    })
    .then(function(commit) {
      return Promise.all([
        test.repository.getBranchCommit(testBranchName),
        test.repository.getBranchCommit("master")
      ]);
    })
    .then(function(commits) {
      return NodeGit.Merge.commits(test.repository, commits[0], commits[1],
        null);
    })
    .then(function(index) {
      assert.ok(index);
      assert.ok(index.hasConflicts && index.hasConflicts());

      return NodeGit.Checkout.index(test.repository, index);
    })
    .then(function() {
      // Verify that the conflict has been written to disk
      var conflictedContent = fse.readFileSync(packageJsonPath, "utf-8");

      assert.ok(~conflictedContent.indexOf("<<<<<<< ours"));
      assert.ok(~conflictedContent.indexOf("======="));
      assert.ok(~conflictedContent.indexOf(">>>>>>> theirs"));

      // Cleanup
      var opts = {
        checkoutStrategy: Checkout.STRATEGY.FORCE,
        paths: packageJsonName
      };

      return Checkout.head(test.repository, opts);
    })
    .then(function() {
      var finalContent = fse.readFileSync(packageJsonPath, "utf-8");
      assert.equal(finalContent, "\n");
    });
  });
});
